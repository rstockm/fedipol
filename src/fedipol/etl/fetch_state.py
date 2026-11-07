"""Durable account events; SQLite indexes operations, not observation payloads.

One ETL owns the journal under the existing process lock. HTTP workers may append
instance cooldowns; only the orchestration thread applies events to Django.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
import uuid
from collections import deque
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from fedipol.etl import PIPELINE_VERSION

logger = logging.getLogger(__name__)
SCHEMA = 1


def timestamp(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.timestamp() if parsed.tzinfo else None
    except (ValueError, TypeError, OverflowError):
        return None


def valid_observation(data):
    posts, recent = data.get("posts_count"), data.get("recent_posts_count")
    return (isinstance(posts, int) and not isinstance(posts, bool) and posts >= 0
            and isinstance(recent, int) and not isinstance(recent, bool) and 0 <= recent <= posts
            and isinstance(data.get("is_bot"), bool) and timestamp(data.get("fetched_at")) is not None
            and not data.get("error"))


def _encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


class FetchJournal:
    """Checksummed append-only events, separate from disposable run checkpoints."""

    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "events.jsonl"
        self._lock = threading.Lock()
        self._pending = deque()
        # A process can die halfway through a write. Never append to that tail.
        if self.path.exists():
            with self.path.open("rb+") as stream:
                end = 0
                for line in stream:
                    if not line.endswith(b"\n"):
                        stream.truncate(end)
                        stream.flush()
                        os.fsync(stream.fileno())
                        break
                    end = stream.tell()

    def append(self, kind, data):
        event = {"schema": SCHEMA, "producer": PIPELINE_VERSION,
                 "id": uuid.uuid4().hex, "kind": kind, "data": data}
        record = {"event": event, "sha256": hashlib.sha256(_encoded(event)).hexdigest()}
        with self._lock:
            with self.path.open("ab") as stream:
                stream.write(_encoded(record) + b"\n")
                stream.flush()
                os.fsync(stream.fileno())
            self._pending.append(event)
        return event

    def events(self):
        if not self.path.exists():
            return
        with self.path.open("rb") as stream:
            for number, line in enumerate(stream, 1):
                try:
                    record = json.loads(line)
                    event = record["event"]
                    if (event["schema"] != SCHEMA
                            or hashlib.sha256(_encoded(event)).hexdigest() != record["sha256"]):
                        raise ValueError("schema/checksum")
                    yield event
                except (ValueError, KeyError, TypeError):
                    logger.warning("Ignoring invalid fetch event at line %d", number)

    def pending(self):
        with self._lock:
            result = list(self._pending)
            self._pending.clear()
        return result


class FetchState:
    def __init__(self, journal: FetchJournal, *, now=time.time, persist=None):
        self.journal, self.now, self.persist = journal, now, persist
        self.accounts = {}
        self.instances = {}
        self._observations = {}
        self._seen = set()
        for event in journal.events():
            self._apply(event)

    def _account(self, url, first_seen):
        return self.accounts.setdefault(url, {
            "url": url, "instance": urlsplit(url).hostname, "first_seen_at": first_seen,
            "active": True,
            "last_attempt_at": None, "last_success_at": None, "next_attempt_at": 0,
            "consecutive_failures": 0, "not_found_count": 0, "first_not_found_at": None,
            "review_required": False, "last_error_category": "", "observation_ref": "",
        })

    def _apply(self, event):
        if event["id"] in self._seen:
            return
        data = event["data"]
        if event["kind"] == "register":
            for url in data["urls"]:
                self._account(url, data["at"])
        elif event["kind"] == "plan":
            active = set(data["urls"])
            for url, account in self.accounts.items():
                account["active"] = url in active
        elif event["kind"] == "instance":
            self.instances[data["host"]] = data["state"]
        elif event["kind"] == "attempt":
            url, at, result = data["url"], data["finished_at"], data["result"]
            state = self._account(url, data["started_at"])
            observed_at = timestamp(result.get("fetched_at"))
            succeeded = valid_observation(result)
            if succeeded and (state["last_success_at"] is None or observed_at >= state["last_success_at"]):
                self._observations[url] = result
                state["last_success_at"] = observed_at
                state["observation_ref"] = event["id"]
            if state["last_attempt_at"] is None or at >= state["last_attempt_at"]:
                if not result.get("deferred") or result.get("request_count", 0) > 0:
                    state["last_attempt_at"] = at if data["run_id"] != "bootstrap" else data["started_at"]
                state["last_error_category"] = result.get("error_category") or ""
                if succeeded:
                    state.update(consecutive_failures=0, not_found_count=0,
                                 first_not_found_at=None, review_required=False, next_attempt_at=at)
                elif result.get("deferred"):
                    state["next_attempt_at"] = max(at, result.get("deferred_until") or at+60)
                else:
                    state["consecutive_failures"] += 1
                    delay = min(86400, 900 * 2**min(state["consecutive_failures"]-1, 7))
                    if result.get("http_status") in (401, 403):
                        delay = 86400
                    if result.get("http_status") in (404, 410) and result.get("phase") == "lookup":
                        if state["first_not_found_at"] is None:
                            state["first_not_found_at"] = at
                        state["not_found_count"] += 1
                        delay = 86400
                        state["review_required"] = (state["not_found_count"] >= 3
                                                    and at-state["first_not_found_at"] >= 7*86400)
                    state["next_attempt_at"] = at+delay
        else:
            raise ValueError("Unknown fetch event kind")
        if self.persist:
            self.persist(self, event)
        self._seen.add(event["id"])

    def flush(self):
        for event in self.journal.pending():
            self._apply(event)

    def register(self, urls):
        new = sorted(set(urls) - self.accounts.keys())
        if new:
            self.journal.append("register", {"urls": new, "at": self.now()})
            self.flush()

    def record(self, run_id, result, *, started_at):
        data = asdict(result)
        if result.ok and not valid_observation(data):
            raise ValueError("Refusing to persist an invalid successful observation")
        self.journal.append("attempt", {
            "run_id": run_id, "url": result.url, "started_at": started_at,
            "finished_at": self.now(), "result": data,
        })
        self.flush()

    def plan(self, urls):
        self.register(urls)
        self.journal.append("plan", {"urls": sorted(set(urls))})
        self.flush()

    def instance_event(self, host, state):
        # Called in HTTP workers: journal only, never Django/SQLite writes.
        self.journal.append("instance", {"host": host, "state": dict(state)})

    def ordered(self, urls, *, now=None):
        now = self.now() if now is None else now
        self.register(urls)
        eligible = [u for u in urls if self.accounts[u]["next_attempt_at"] <= now]

        def key(url):
            s = self.accounts[url]
            success = s["last_success_at"]
            return (success is not None, success if success is not None else s["first_seen_at"],
                    s["last_attempt_at"] or 0, url)

        return sorted(eligible, key=key)

    def observations(self):
        fields = ("url", "posts_count", "recent_posts_count", "created_at", "is_bot", "fetched_at")
        return [{key: result[key] for key in fields} for result in self._observations.values()]

    def seed(self, rows):
        """Bootstrap real observed times, never pretend migration time is freshness."""
        from fedipol.etl.sources.mastodon import EnrichmentResult

        for row in rows:
            at = timestamp(row.get("fetched_at"))
            state = self.accounts.get(row["url"], {})
            if at is not None and (state.get("last_success_at") is None or at > state["last_success_at"]):
                if valid_observation(row):
                    self.journal.append("attempt", {
                        "run_id": "bootstrap", "url": row["url"], "started_at": at,
                        "finished_at": at, "result": asdict(EnrichmentResult(**row)),
                    })
                    self.flush()
