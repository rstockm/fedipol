"""Orchestrierung des taeglichen ETL-Laufs.

Reihenfolge: Lock -> Run anlegen -> Raw Extract -> Staging -> Anreicherung
(mit Checkpoints und LKG) -> Marts -> Export -> Qualitaet -> atomare
Publikation -> Aktivierung. Ein fehlgeschlagener Lauf veraendert die
aktive Generation nicht.
"""

from __future__ import annotations

import hashlib
import json
import logging
import signal
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import yaml

from fedipol.etl import PIPELINE_VERSION
from fedipol.etl.checkpoint import CheckpointStore
from fedipol.etl.export import build_dashboard_rows, build_export, write_export
from fedipol.etl.generations import (
    activate_generation,
    cleanup_generations,
    cleanup_raw_runs,
    find_fallback_generation,
    publish_generation,
    read_previous_observations,
)
from fedipol.etl.locking import FileLock, LockBusy
from fedipol.etl.normalize import canonical_url, instance_priority, position_priority
from fedipol.etl.overrides import OverrideSet, load_overrides, validate_against
from fedipol.etl.paths import DataPaths, load_paths
from fedipol.etl.quality import check_export, check_freshness_landscape
from fedipol.etl.sources.mastodon import EnrichmentResult, MastodonEnricher
from fedipol.etl.sources.mastodon_directory import DirectoryAccount, fetch_instance_directory
from fedipol.etl.sources.wikidata import load_query, parse_bindings, run_sparql_query
from fedipol.etl.staging import (
    build_marts,
    insert_lkg_observations,
    insert_observations,
    insert_party_aliases,
    open_building_database,
)

logger = logging.getLogger(__name__)


class PipelineError(RuntimeError):
    pass


@dataclass
class PipelineConfig:
    limit: int | None = None          # Entwicklungsmodus: nur N Accounts anreichern
    offline: bool = False             # keine externen Abrufe (Tests/Fixtures)
    wikidata_offline: bool = False    # nur Wikidata aus Fixtures (Restriktive Netze)
    trigger: str = "scheduler"
    run_id: str | None = None         # deterministische ID (Tests); sonst UTC-Zeitstempel


@dataclass
class PipelineResult:
    run_id: str
    published: bool
    account_count: int = 0
    fresh_count: int = 0
    stale_count: int = 0
    missing_count: int = 0
    warnings: list[str] = field(default_factory=list)
    error: str | None = None


class InstancePacer:
    """Mindestabstand zwischen Request-Starts je Instanz (Rate-Limit-Schonung)."""

    def __init__(self, min_interval: float) -> None:
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._next_slot: dict[str, float] = {}

    def reserve(self, host: str) -> float:
        """Liefert die Wartezeit in Sekunden bis zum erlaubten Request-Start."""
        import time as _time

        with self._lock:
            now = _time.monotonic()
            start = max(now, self._next_slot.get(host, 0.0))
            self._next_slot[host] = start + self.min_interval
            return start - now


class _SigTermGuard:
    """Setzt ein Flag, wenn der Prozess SIGTERM erhaelt."""

    def __init__(self) -> None:
        self.triggered = False
        self._previous = None

    def __enter__(self) -> _SigTermGuard:
        try:
            self._previous = signal.signal(signal.SIGTERM, self._handle)
        except ValueError:  # kein Main-Thread (Tests)
            self._previous = None
        return self

    def _handle(self, signum, frame):  # noqa: ANN001
        self.triggered = True

    def __exit__(self, *exc_info) -> None:  # noqa: ANN002
        if self._previous is not None:
            try:
                signal.signal(signal.SIGTERM, self._previous)
            except ValueError:
                pass


class Pipeline:
    def __init__(
        self,
        paths: DataPaths | None = None,
        recorder=None,  # noqa: ANN001
        config: PipelineConfig | None = None,
    ) -> None:
        self.paths = paths or load_paths()
        self.recorder = recorder
        self.config = config or PipelineConfig()
        self._load_source_config()

    # ------------------------------------------------------------- Konfiguration

    def _load_source_config(self) -> None:
        config_path = self.paths.config_dir() / "sources.yaml"
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        self.sources = raw
        self.wikidata_endpoint = raw["wikidata"]["endpoint"]
        self.wikidata_language = raw["wikidata"].get("language", "de")
        self.queries = raw["wikidata"]["queries"]
        self.party_instances: dict[str, str] = dict(raw["party_instances"])
        self.institution_instances: list[str] = list(raw["institution_instances"])
        self.directory_config = dict(raw.get("directory", {}))
        self.bot_keywords: list[str] = list(raw.get("bot_keywords", []))
        self.excluded_accounts_file = raw.get("excluded_accounts_file")

    def _overrides(self) -> OverrideSet:
        return load_overrides(self.paths.config_dir() / "account_overrides.yaml")

    # --------------------------------------------------------------- Haupteinritt

    def run(self) -> PipelineResult:
        run_id = self.config.run_id or datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        lock = FileLock(self.paths.locks_dir / "etl.lock")
        try:
            lock.acquire()
        except LockBusy:
            logger.warning("ETL-Lauf abgelehnt: bereits ein Lauf aktiv")
            return PipelineResult(run_id=run_id, published=False, error="lock_busy")

        try:
            self.paths.ensure_run_dirs(run_id)
            if self.recorder:
                self.recorder.create_run(run_id, self.config.trigger, PIPELINE_VERSION)
                self.recorder.mark_stale_runs_failed()

            with _SigTermGuard() as sigterm:
                try:
                    result = self._execute(run_id, sigterm)
                except Exception as exc:  # noqa: BLE001
                    logger.exception("ETL-Lauf %s fehlgeschlagen", run_id)
                    if self.recorder:
                        self.recorder.finish_run(
                            run_id, "failed", error_summary=str(exc)[:2000]
                        )
                    return PipelineResult(run_id=run_id, published=False, error=str(exc))
            if sigterm.triggered and not result.published:
                self._mark_failed(run_id, "SIGTERM empfangen; Lauf ohne Publikation abgebrochen")
            return result
        finally:
            lock.release()

    def _mark_failed(self, run_id: str, message: str) -> None:
        logger.error("%s", message)
        if self.recorder:
            self.recorder.finish_run(run_id, "failed", error_summary=message)

    # ----------------------------------------------------------------- Schritte

    def _execute(self, run_id: str, sigterm: _SigTermGuard) -> PipelineResult:
        warnings: list[str] = []
        raw_dir = self.paths.run_raw_dir(run_id)

        def step(name, fn):  # noqa: ANN001
            db_step = self.recorder.record_step(run_id, name) if self.recorder else None
            result = fn()
            if db_step is not None:
                self.recorder.finish_step(db_step, "succeeded", output_count=result)
            return result

        # --- 1. Wikidata -------------------------------------------------
        wikidata_rows: list[dict] = []
        for query_name, query_path in self.queries.items():
            query_text = load_query(self.paths.config_dir(), _rel_query(query_path))
            if self.config.offline or self.config.wikidata_offline:
                binding_rows = self._load_fixture_bindings(query_name)
            else:
                response = run_sparql_query(
                    self.wikidata_endpoint,
                    query_text,
                    language=self.wikidata_language,
                    max_retries=3,
                )
                if not response.ok:
                    raise PipelineError(f"Wikidata-Abfrage {query_name}: HTTP {response.status}")
                self._store_raw(raw_dir, f"wikidata_{query_name}.json", response.content)
                binding_rows = parse_bindings(response)
            wikidata_rows.extend(
                {**row, "_source_query": query_name} for row in binding_rows
            )
            if sigterm.triggered:
                raise PipelineError("SIGTERM waehrend Wikidata-Extraktion")

        # --- 2. Instanzverzeichnisse ------------------------------------
        directory_rows: list[DirectoryAccount] = []
        page_size = int(self.directory_config.get("page_size", 80))
        max_accounts = int(self.directory_config.get("max_accounts_per_instance", 1000))
        if not self.config.offline:
            with ThreadPoolExecutor(max_workers=3) as pool:
                futures = {}
                for instance, party in self.party_instances.items():
                    futures[pool.submit(
                        fetch_instance_directory, instance,
                        kind="party", party=party,
                        page_size=page_size, max_accounts=max_accounts,
                    )] = instance
                for instance in self.institution_instances:
                    futures[pool.submit(
                        fetch_instance_directory, instance,
                        kind="institution", party=None,
                        page_size=page_size, max_accounts=max_accounts,
                    )] = instance
                for future in as_completed(futures):
                    instance = futures[future]
                    try:
                        directory_rows.extend(future.result())
                    except Exception as exc:  # noqa: BLE001
                        warnings.append(f"Verzeichnis {instance} unvollstaendig: {exc}")

        # --- 3. Kandidaten kanonisieren ----------------------------------
        candidates: dict[str, dict] = {}
        for row in wikidata_rows:
            try:
                canon = canonical_url(row["account"])
            except ValueError:
                continue
            entry = candidates.setdefault(
                canon,
                {
                    "url": canon,
                    "name": row.get("itemLabel") or "Unbekannt",
                    "kind": "institution" if row["_source_query"] == "institutions" else "person",
                    "position": row.get("positionLabel") or row.get("typeLabel"),
                    "party": row.get("partyLabel"),
                    "qid": row.get("qid"),
                    "instance": canon.split("//", 1)[-1].split("/", 1)[0],
                    "source": f"wikidata:{row['_source_query']}",
                },
            )
            # Wikidata-Kandidaten bevorzugt fuellen fehlende Felder
            entry["position"] = entry["position"] or row.get("positionLabel") or row.get("typeLabel")
            entry["party"] = entry["party"] or row.get("partyLabel")
        for row in directory_rows:
            try:
                canon = canonical_url(row.account_url)
            except ValueError:
                continue
            if canon in candidates:
                continue
            if row.kind == "institution":
                position, party = "Institution (Instanz)", None
            else:
                position, party = row.party, row.party
            candidates[canon] = {
                "url": canon,
                "name": row.name,
                "kind": row.kind,
                "position": position,
                "party": party,
                "qid": None,
                "instance": row.instance,
                "source": f"directory:{row.instance}",
            }

        candidate_list = list(candidates.values())
        logger.info("Kandidaten: %d", len(candidate_list))

        # --- 4. Overrides laden und Anreicherung planen ------------------
        overrides = self._overrides()
        excluded_urls = self._load_excluded_accounts()

        limit = self.config.limit
        to_enrich = [
            c for c in candidate_list
            if c["url"] not in excluded_urls
            and c["url"] not in {o.url for o in overrides.entries if o.replaced_by}
        ]
        if limit:
            to_enrich = to_enrich[:limit]

        checkpoint = CheckpointStore(self.paths.run_checkpoint(run_id))
        previous_gen = (
            self.recorder.get_active_generation() if self.recorder else find_fallback_generation(self.paths)
        )
        lkg_rows = read_previous_observations(self.paths, previous_gen)

        enricher = MastodonEnricher(bot_keywords=self.bot_keywords)
        results = self._enrich_accounts(enricher, to_enrich, checkpoint, sigterm, offline=self.config.offline)
        ok_results = [r for r in results if r.ok]
        fresh_failures = check_freshness_landscape(len(ok_results), len(to_enrich), self._etl_limits())
        if fresh_failures:
            raise PipelineError("; ".join(fresh_failures))

        # --- 5. DuckDB: Staging + Marts ----------------------------------
        building_db = self.paths.building_generation(run_id)
        conn = open_building_database(building_db)
        try:
            insert_party_aliases(conn)
            # Kandidaten in staging laden
            for c in candidate_list:
                conn.execute(
                    "INSERT INTO staging.candidates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        c["url"], c["url"], c["name"], c["kind"], c["position"], c["party"],
                        c["qid"], c["instance"], c["source"],
                        instance_priority(c["url"]), position_priority(c["position"] or ""),
                    ],
                )
            insert_observations(conn, ok_results)
            insert_lkg_observations(conn, lkg_rows)
            build_marts(conn)

            # --- 6. Export bauen -----------------------------------------
            rows = build_dashboard_rows(conn, overrides, self.bot_keywords, excluded_urls)
            exported_urls = {r.url for r in rows}
            known = {c["url"] for c in candidate_list}
            warnings.extend(validate_against(overrides, known))
            missing_count = len(known - exported_urls - {o.url for o in overrides.entries if o.exclude})
            export = build_export(
                rows,
                run_id=run_id,
                pipeline_version=PIPELINE_VERSION,
                missing_count=missing_count,
                warning_count=len(warnings),
            )
        finally:
            conn.close()

        # --- 7. Qualitaet ------------------------------------------------
        previous_count = None
        if lkg_rows:
            previous_count = len(lkg_rows)
        failures = check_export(export, previous_account_count=previous_count, limits=self._etl_limits())
        if failures:
            raise PipelineError("Qualitaetspruefungen fehlgeschlagen: " + "; ".join(failures))
        if sigterm.triggered:
            raise PipelineError("SIGTERM vor Publikation")

        # --- 8. Export + Publikation (atomar) -----------------------------
        write_export(export, self.paths.building_export_dir(run_id))
        publish_generation(self.paths, run_id)
        if self.recorder:
            activate_generation(self.recorder, run_id)

        # --- 9. Bereinigung ----------------------------------------------
        cleanup_generations(self.paths, keep=self._etl_limits().get("generations_keep", 3))
        cleanup_raw_runs(self.paths, keep_runs=self._etl_limits().get("raw_keep_runs", 7))

        if self.recorder:
            self.recorder.finish_run(
                run_id,
                "succeeded",
                published_generation=run_id,
                account_count=export.account_count,
                fresh_count=export.fresh_count,
                stale_count=export.stale_count,
            )

        return PipelineResult(
            run_id=run_id,
            published=True,
            account_count=export.account_count,
            fresh_count=export.fresh_count,
            stale_count=export.stale_count,
            missing_count=missing_count,
            warnings=warnings,
        )

    # --------------------------------------------------------------- Anreicherung

    def _enrich_accounts(self, enricher, accounts, checkpoint, sigterm, *, offline=False):  # noqa: ANN001
        """Instanzbewusste Anreicherung mit globalem und Instanz-Limit."""
        if offline:
            # Offline-Modus: Checkpoint-Inhalte als Ergebnisse verwenden.
            results = []
            for account in accounts:
                entry = checkpoint.get(account["url"])
                if entry:
                    results.append(EnrichmentResult(**entry))
                else:
                    results.append(
                        EnrichmentResult(url=account["url"], error="offline: keine Checkpoint-Daten")
                    )
            return results

        per_instance = int(self._etl_limits().get("per_instance_concurrency", 2))
        global_limit = int(self._etl_limits().get("global_concurrency", 6))
        min_interval = float(self._etl_limits().get("per_instance_min_interval", 1.0))
        instance_slots: dict[str, threading.Semaphore] = {}
        global_slot = threading.Semaphore(global_limit)
        pacer = InstancePacer(min_interval)

        def work(account):  # noqa: ANN001
            if checkpoint.completed(account["url"]):
                entry = checkpoint.get(account["url"])
                return EnrichmentResult(**entry)
            url = account["url"]
            host = url.split("//", 1)[-1].split("/", 1)[0]
            sem = instance_slots.setdefault(host, threading.Semaphore(per_instance))
            with global_slot, sem:
                if sigterm.triggered:
                    return None
                delay = pacer.reserve(host)
                if delay > 0:
                    import time as _time

                    _time.sleep(delay)
                if sigterm.triggered:
                    return None
                result = enricher.enrich(url)
                checkpoint.record(result)
                return result

        results = []
        with ThreadPoolExecutor(max_workers=global_limit) as pool:
            futures = [pool.submit(work, account) for account in accounts]
            for future in as_completed(futures):
                result = future.result()
                if result is not None:
                    results.append(result)
                if sigterm.triggered:
                    pool.shutdown(wait=False, cancel_futures=True)
                    break
        if sigterm.triggered:
            raise PipelineError("SIGTERM waehrend Anreicherung; Checkpoints ermoeglichen Wiederaufnahme")
        return results

    # --------------------------------------------------------------- Helfer

    def _etl_limits(self) -> dict:
        try:
            from django.conf import settings

            return dict(settings.ETL)
        except Exception:  # noqa: BLE001 (ETL ohne Django lauffaehig)
            return {
                "max_stale_share": 0.15,
                "max_account_drop_share": 0.10,
                "max_failed_enrichment_share": 0.30,
                "generations_keep": 3,
                "raw_keep_runs": 7,
                "per_instance_concurrency": 2,
                "global_concurrency": 6,
            }

    def _load_excluded_accounts(self) -> set[str]:
        if not self.excluded_accounts_file:
            return set()
        path = Path(self.excluded_accounts_file)
        if not path.is_absolute():
            path = self.paths.config_dir().parent / self.excluded_accounts_file
        if not path.is_file():
            return set()
        data = json.loads(path.read_text(encoding="utf-8"))
        out = set()
        for url in data.get("excluded_accounts", []):
            try:
                out.add(canonical_url(url))
            except ValueError:
                continue
        return out

    def _load_fixture_bindings(self, query_name: str) -> list[dict]:
        fixture = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / f"wikidata_{query_name}.json"
        if not fixture.is_file():
            return []
        data = json.loads(fixture.read_text(encoding="utf-8"))
        return parse_bindings(_FakeResult(data))

    def _store_raw(self, raw_dir: Path, name: str, content: bytes) -> None:
        raw_dir.mkdir(parents=True, exist_ok=True)
        (raw_dir / name).write_bytes(content)
        (raw_dir / f"{name}.meta.json").write_text(
            json.dumps(
                {
                    "file": name,
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "bytes": len(content),
                    "stored_at": datetime.now(UTC).isoformat(timespec="seconds"),
                },
                indent=2,
            ),
            encoding="utf-8",
        )


def _rel_query(path: str) -> str:
    """config/queries/x.sparql -> nur Dateiname (Queriedateien liegen gebuendelt)."""
    return Path(path).name


class _FakeResult:
    """Minimale Nachbildung eines FetchResult fuer Offline-Fixtures."""

    def __init__(self, data: dict) -> None:
        self._data = data

    def json(self) -> dict:
        return self._data
