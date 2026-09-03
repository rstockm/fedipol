"""Gemeinsame Test-Infrastruktur fuer fedipol."""

import os
import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
TEST_DATA_DIR = REPO_ROOT / "tests" / ".test-data"

# Muss vor dem Django-Import gesetzt werden (settings.py liest beim Import).
os.environ.setdefault("FEDIPOL_DATA_DIR", str(TEST_DATA_DIR))


@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    """Tests erhalten eine isolierte Konfigurationskopie ohne Kuratierliste."""
    import shutil

    config_copy = tmp_path / "config"
    shutil.copytree(REPO_ROOT / "config", config_copy)
    curated = config_copy / "curated_accounts.md"
    if curated.exists():
        curated.unlink()
    monkeypatch.setenv("FEDIPOL_CONFIG_DIR", str(config_copy))
    return config_copy


@pytest.fixture()
def data_paths(tmp_path, monkeypatch):
    """Isoliertes Datenverzeichnis pro Test."""
    monkeypatch.setenv("FEDIPOL_DATA_DIR", str(tmp_path))
    from fedipol.etl.paths import DataPaths

    paths = DataPaths(root=tmp_path)
    paths.root.mkdir(parents=True, exist_ok=True)
    return paths


@pytest.fixture()
def permissive_limits(monkeypatch):
    """Entspannte Qualitaetsgrenzen fuer Offline-Scenario-Tests."""
    from fedipol.etl.pipeline import Pipeline

    limits = {
        "max_stale_share": 1.0,
        "max_account_drop_share": 1.0,
        "max_failed_enrichment_share": 1.0,
        "generations_keep": 3,
        "raw_keep_runs": 7,
        "per_instance_concurrency": 2,
        "global_concurrency": 4,
    }
    monkeypatch.setattr(Pipeline, "_etl_limits", lambda self: limits)
    return limits


@pytest.fixture()
def strict_drop_limits(monkeypatch):
    """Grenzwerte: Publication muss bei Accountschwund fehlschlagen."""
    from fedipol.etl.pipeline import Pipeline

    limits = {
        "max_stale_share": 1.0,
        "max_account_drop_share": 0.10,
        "max_failed_enrichment_share": 1.0,
        "generations_keep": 3,
        "raw_keep_runs": 7,
        "per_instance_concurrency": 2,
        "global_concurrency": 4,
    }
    monkeypatch.setattr(Pipeline, "_etl_limits", lambda self: limits)
    return limits


class InMemoryRecorder:
    """Test-Doppel fuer den DjangoRunRecorder."""

    def __init__(self):
        self.runs = {}
        self.steps = []
        self.active_generation = None
        self.previous_generation = None

    def create_run(self, run_id, trigger, pipeline_version):
        self.runs[run_id] = {"status": "running", "trigger": trigger, "error": ""}

    def record_step(self, run_id, step_name, attempt=1):
        marker = (run_id, step_name)
        self.steps.append({"run_id": run_id, "step": step_name, "status": "running"})
        return marker

    def finish_step(self, step, status, **kwargs):
        self.steps.append({"run_id": step[0], "step": f"{step[1]}:{status}"})

    def finish_run(self, run_id, status, **kwargs):
        self.runs[run_id]["status"] = status
        self.runs[run_id].update(kwargs)

    def activate_generation(self, generation_id, previous_generation_id):
        self.previous_generation = self.active_generation
        self.active_generation = generation_id

    def get_active_generation(self):
        return self.active_generation

    def mark_stale_runs_failed(self, max_age_minutes=240):
        return 0


@pytest.fixture()
def recorder():
    return InMemoryRecorder()


@pytest.fixture(scope="session", autouse=True)
def _clean_test_data():
    if TEST_DATA_DIR.exists():
        shutil.rmtree(TEST_DATA_DIR)
    TEST_DATA_DIR.mkdir(parents=True, exist_ok=True)
    yield
    shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)
