"""One request slot per host, shared cooldowns and bounded run budgets."""
from __future__ import annotations

import random
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

DEFAULT_POLICIES = {
    "gruene.social": {"interval": 5.0, "budget_seconds": 3600, "max_requests": 720},
    "social.bund.de": {"interval": 3.0, "budget_seconds": 2700, "max_requests": 900},
}


class DeferredRequest(Exception):
    def __init__(self, reason, until, host=""):
        super().__init__(reason)
        self.reason, self.until, self.host = reason, until, host


def server_deadline(headers, now):
    """Retry-After (seconds/date) and Mastodon reset (ISO/epoch), case-insensitive."""
    headers = {str(k).lower(): str(v) for k, v in headers.items()}
    deadlines = []
    retry = headers.get("retry-after")
    if retry:
        try:
            deadlines.append(now+max(0, float(retry)))
        except ValueError:
            try:
                deadlines.append(parsedate_to_datetime(retry).timestamp())
            except (ValueError, TypeError, OverflowError):
                pass
    reset = headers.get("x-ratelimit-reset")
    if reset:
        try:
            deadlines.append(float(reset))
        except ValueError:
            try:
                value = datetime.fromisoformat(reset.replace("Z", "+00:00"))
                if value.tzinfo:
                    deadlines.append(value.timestamp())
            except (ValueError, OverflowError):
                pass
    return max([now, *[v for v in deadlines if v < float("inf")]])


class InstanceLimiter:
    def __init__(self, *, policies=None, states=None, persist=None, now=time.time,
                 monotonic=None, sleep=time.sleep, stopped=lambda: False,
                 run_budget_seconds=7200, run_id=None):
        self.now, self.sleep, self.stopped = now, sleep, stopped
        self.monotonic = monotonic or (time.monotonic if now is time.time else now)
        self.deadline = self.monotonic()+run_budget_seconds
        self.policies = {**DEFAULT_POLICIES, **(policies or {})}
        if run_budget_seconds <= 0:
            raise ValueError("Collection run budget must be positive")
        for host in self.policies:
            policy = self.policy(host)
            if (policy["interval"] < 0 or policy["budget_seconds"] <= 0
                    or policy["max_requests"] < 0):
                raise ValueError(f"Invalid collection policy for {host}")
        self.states = {h: dict(s) for h, s in (states or {}).items()}
        self.persist = persist
        self.run_id = run_id
        self._lock = threading.RLock()
        self._host_locks = {}
        self._starts, self._ticks, self._hits = {}, {}, {}
        self.counts = {}

    def policy(self, host):
        return {"interval": 2.0, "budget_seconds": 1800, "max_requests": 900,
                **self.policies.get(host, {})}

    def state(self, host):
        with self._lock:
            return self.states.setdefault(host, {
                "interval": self.policy(host)["interval"], "cooldown_until": 0,
                "next_request_at": 0, "rate_failures": 0, "success_streak": 0,
                "transient_failures": 0,
            })

    def ready_at(self, host):
        with self._lock:
            state = self.state(host)
            return max(state["cooldown_until"], state["next_request_at"])

    def exhausted(self, host):
        with self._lock:
            policy = self.policy(host)
            elapsed = self.monotonic()-self._starts.get(host, self.monotonic())
            return (self.monotonic() >= self.deadline or elapsed >= policy["budget_seconds"]
                    or self.counts.get(host, 0) >= policy["max_requests"]
                    or self._hits.get(host, 0) >= 3 or self.stopped())

    def expires_at(self, host):
        """Wall-clock equivalent of monotonic budgets, for dispatch decisions."""
        remaining = min(self.deadline-self.monotonic(),
                        self.policy(host)["budget_seconds"]
                        - (self.monotonic()-self._starts.get(host, self.monotonic())))
        return self.now()+max(0, remaining)

    def _save(self, host):
        if self.persist:
            self.persist(host, self.state(host))

    @contextmanager
    def request(self, url):
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port:
            raise ValueError("Only HTTPS instance API URLs without credentials/ports are allowed")
        host = parsed.hostname.lower()
        with self._lock:
            slot = self._host_locks.setdefault(host, threading.Lock())
        with slot:
            with self._lock:
                state = self.state(host)
                if self.exhausted(host):
                    raise DeferredRequest("request_budget", self.now()+3600, host)
                if state["cooldown_until"] > self.now():
                    raise DeferredRequest("instance_cooldown", state["cooldown_until"], host)
                self._starts.setdefault(host, self.monotonic())
                wait = max(0, self._ticks.get(host, self.monotonic())-self.monotonic(),
                           state["next_request_at"]-self.now())
            # Only short pacing waits happen in workers, never instance cooldowns.
            while wait > 0:
                if self.stopped() or self.exhausted(host):
                    raise DeferredRequest("request_budget", self.now()+3600, host)
                step = min(wait, 1.0)
                self.sleep(step)
                wait -= step
            with self._lock:
                if self.exhausted(host):
                    raise DeferredRequest("request_budget", self.now()+3600, host)
                if state["cooldown_until"] > self.now():
                    raise DeferredRequest("instance_cooldown", state["cooldown_until"], host)
                interval = max(state["interval"], self.policy(host)["interval"])
                self._ticks[host] = self.monotonic()+interval
                state["next_request_at"] = self.now()+interval
                self.counts[host] = self.counts.get(host, 0)+1
            yield

    def feedback(self, host, status, headers):
        with self._lock:
            state = self.state(host)
            normalized = {str(k).lower(): str(v) for k, v in headers.items()}
            if status == 429:
                state["rate_failures"] += 1
                self._hits[host] = self._hits.get(host, 0)+1
                delay = min(1800, 60*2**min(state["rate_failures"]-1, 5))
                state["cooldown_until"] = max(state["cooldown_until"],
                    server_deadline(headers, self.now()), self.now()+delay+random.uniform(0, 5))
                state["interval"] = min(60, max(self.policy(host)["interval"], state["interval"]*2))
                state["success_streak"] = 0
            elif status is None or status in (500, 502, 503, 504):
                state["transient_failures"] += 1
                delay = min(1800, 30*2**min(state["transient_failures"]-1, 6))
                state["cooldown_until"] = max(state["cooldown_until"], self.now()+delay,
                                              server_deadline(headers, self.now()))
                state["success_streak"] = 0
            elif status == 200:
                state["success_streak"] += 1
                state["transient_failures"] = 0
                if state["success_streak"] >= 20:
                    state["interval"] = max(self.policy(host)["interval"], state["interval"]*0.9)
                    state["rate_failures"] = max(0, state["rate_failures"]-1)
                    state["success_streak"] = 0
            if normalized.get("x-ratelimit-remaining") == "0":
                state["cooldown_until"] = max(state["cooldown_until"],
                                              server_deadline(headers, self.now()))
            state["last_run_id"] = self.run_id
            state["requests_in_run"] = self.counts.get(host, 0)
            self._save(host)
