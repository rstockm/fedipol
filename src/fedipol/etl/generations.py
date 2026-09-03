"""Unveraenderliche Generationen: Publikation, Aktivierung, Recovery, Bereinigung."""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path

from fedipol.etl.paths import DataPaths

logger = logging.getLogger(__name__)


class GenerationError(RuntimeError):
    pass


def publish_generation(paths: DataPaths, run_id: str) -> Path:
    """Benennt Baustein-DuckDB und Baustein-Export atomar auf die Generation um."""
    building_db = paths.building_generation(run_id)
    final_db = paths.generation(run_id)
    if not building_db.is_file():
        raise GenerationError(f"Baustein-Datenbank fehlt: {building_db}")
    if final_db.exists():
        raise GenerationError(f"Generation existiert bereits: {final_db}")
    os.replace(building_db, final_db)

    building_export = paths.building_export_dir(run_id)
    final_export = paths.export_dir(run_id)
    if not (building_export / "fedipol_data.json").is_file():
        raise GenerationError(f"Baustein-Export fehlt: {building_export}")
    os.replace(building_export, final_export)
    return final_export


def activate_generation(recorder, run_id: str) -> None:
    """Setzt den aktiven Generationszeiger in einer kurzen Transaktion."""
    previous = recorder.get_active_generation()
    recorder.activate_generation(
        generation_id=run_id,
        previous_generation_id=previous or "",
    )


def get_active_generation(recorder) -> str | None:
    return recorder.get_active_generation()


def find_fallback_generation(paths: DataPaths, exclude: str | None = None) -> str | None:
    """Neueste vollstaendig vorhandene Generation als kontrollierter Fallback."""
    if not paths.generations_dir.is_dir():
        return None
    candidates = []
    for db_path in paths.generations_dir.glob("*.duckdb"):
        gen_id = db_path.stem
        if gen_id.startswith(".") or gen_id == exclude:
            continue
        export_json = paths.export_dir(gen_id) / "fedipol_data.json"
        if export_json.is_file():
            try:
                mtime = db_path.stat().st_mtime
            except OSError:
                continue
            candidates.append((mtime, gen_id))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]


def read_previous_observations(paths: DataPaths, generation_id: str | None) -> list[dict]:
    """Lesender Zugriff auf mart.account_facts der aktiven Vorgaenger-Generation."""
    if not generation_id:
        return []
    db_path = paths.generation(generation_id)
    if not db_path.is_file():
        logger.warning("Vorgaenger-Generation fehlt fuer LKG: %s", db_path)
        return []
    import duckdb

    try:
        conn = duckdb.connect(str(db_path), read_only=True)
        try:
            rows = conn.execute(
                """
                SELECT url, posts_count, recent_posts_count, created_at, is_bot, fetched_at
                FROM mart.account_facts
                """
            ).fetchall()
        finally:
            conn.close()
    except Exception as exc:  # duckdb IOException etc.
        logger.error("Vorgaenger-Generation nicht lesbar (%s): %s", generation_id, exc)
        return []
    return [
        {
            "url": row[0],
            "posts_count": row[1],
            "recent_posts_count": row[2],
            "created_at": row[3],
            "is_bot": row[4],
            "fetched_at": row[5],
        }
        for row in rows
    ]


def cleanup_generations(paths: DataPaths, keep: int = 3) -> list[str]:
    """Entfernt aeltere Generationen (DuckDB + Export) ausser den neuesten `keep`."""
    if not paths.generations_dir.is_dir():
        return []
    entries = sorted(
        (p for p in paths.generations_dir.glob("*.duckdb") if not p.stem.startswith(".")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    removed: list[str] = []
    for db_path in entries[keep:]:
        gen_id = db_path.stem
        try:
            db_path.unlink(missing_ok=True)
            export_dir = paths.export_dir(gen_id)
            if export_dir.is_dir():
                shutil.rmtree(export_dir)
            removed.append(gen_id)
        except OSError as exc:
            logger.warning("Bereinigung von %s fehlgeschlagen: %s", gen_id, exc)
    return removed


def cleanup_raw_runs(paths: DataPaths, keep_runs: int = 7) -> list[str]:
    removed: list[str] = []
    if not paths.raw_dir.is_dir():
        return removed
    runs = sorted(
        (p for p in paths.raw_dir.iterdir() if p.is_dir()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for run_dir in runs[keep_runs:]:
        try:
            shutil.rmtree(run_dir)
            removed.append(run_dir.name)
        except OSError as exc:
            logger.warning("Raw-Bereinigung von %s fehlgeschlagen: %s", run_dir, exc)
    return removed


def recover_hanging_run(recorder, run_id: str | None = None) -> int:
    """Markiert beim Start als 'running' zurueckgelassene Laeufe als fehlgeschlagen."""
    return recorder.mark_stale_runs_failed()


def load_manifest(paths: DataPaths, generation_id: str) -> dict | None:
    manifest_path = paths.export_dir(generation_id) / "manifest.json"
    if not manifest_path.is_file():
        return None
    return json.loads(manifest_path.read_text(encoding="utf-8"))
