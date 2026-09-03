"""Tests fuer Generationspublikation: atomar, aktiviert, Fallback, Bereinigung."""
import json

import pytest

from fedipol.etl.generations import (
    find_fallback_generation,
    publish_generation,
    read_previous_observations,
)
from fedipol.etl.paths import DataPaths


def _make_generation(paths: DataPaths, run_id: str) -> None:
    building = paths.building_generation(run_id)
    building.parent.mkdir(parents=True, exist_ok=True)
    building.write_bytes(b"duckdb-placeholder")
    export_dir = paths.building_export_dir(run_id)
    export_dir.mkdir(parents=True, exist_ok=True)
    (export_dir / "fedipol_data.json").write_text(json.dumps({"data": {}}), encoding="utf-8")
    publish_generation(paths, run_id)


def test_publish_is_atomic_and_complete(data_paths):
    _make_generation(data_paths, "RUN-A")
    assert data_paths.generation("RUN-A").is_file()
    assert not data_paths.building_generation("RUN-A").exists()
    assert (data_paths.export_dir("RUN-A") / "fedipol_data.json").is_file()
    assert not data_paths.building_export_dir("RUN-A").exists()


def test_publish_fails_on_missing_building(data_paths):
    from fedipol.etl.generations import GenerationError

    with pytest.raises(GenerationError):
        publish_generation(data_paths, "RUN-MISSING")


def test_fallback_returns_newest_complete_generation(data_paths):
    _make_generation(data_paths, "RUN-OLD")
    _make_generation(data_paths, "RUN-NEW")
    assert find_fallback_generation(data_paths) == "RUN-NEW"
    # aktive Generation ausgeschlossen
    assert find_fallback_generation(data_paths, exclude="RUN-NEW") == "RUN-OLD"


def test_previous_observations_readable(data_paths):
    import duckdb

    _make_generation(data_paths, "RUN-A")
    # Platzhalter durch echte DuckDB mit mart.account_facts ersetzen
    db_path = data_paths.generation("RUN-A")
    db_path.unlink()  # Platzhalter entfernen, damit duckdb neu anlegen kann
    conn = duckdb.connect(str(db_path))
    conn.execute("CREATE SCHEMA IF NOT EXISTS mart")
    conn.execute(
        "CREATE TABLE mart.account_facts AS SELECT "
        "'https://x.social/@a' AS url, 5 AS posts_count, 1 AS recent_posts_count, "
        "'2022-01-01T00:00:00.000Z' AS created_at, FALSE AS is_bot, "
        "'2026-09-03T02:00:00+00:00' AS fetched_at, 'fresh' AS freshness"
    )
    conn.close()

    rows = read_previous_observations(data_paths, "RUN-A")
    assert len(rows) == 1
    assert rows[0]["url"] == "https://x.social/@a"
    assert rows[0]["posts_count"] == 5


def test_cleanup_keeps_recent_generations(data_paths):
    _make_generation(data_paths, "RUN-1")
    _make_generation(data_paths, "RUN-2")
    _make_generation(data_paths, "RUN-3")
    _make_generation(data_paths, "RUN-4")

    removed = __import__("fedipol.etl.generations", fromlist=["cleanup_generations"]).cleanup_generations(
        data_paths, keep=2
    )
    assert "RUN-1" in removed
    assert not data_paths.generation("RUN-1").exists()
    assert data_paths.generation("RUN-3").is_file()
    assert data_paths.generation("RUN-4").is_file()
