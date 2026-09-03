"""HTTP-Endpunkte: Health, Freshness, Dashboard-Auslieferung, Export."""
import json

import pytest
from django.test import Client

from fedipol.ops.models import ActiveGeneration, EtlRun
from fedipol.ops.recorder import DjangoRunRecorder

from .test_pipeline_offline import FIXTURE_ACCOUNTS, make_pipeline, seed_checkpoint

pytestmark = pytest.mark.django_db


@pytest.fixture()
def published_generation(data_paths, permissive_limits):
    """Fuehrt einen Offline-ETL aus und aktiviert die Generation ueber SQLite."""
    recorder = DjangoRunRecorder()
    seed_checkpoint(data_paths, "RUN-WEB")
    result = make_pipeline(data_paths, recorder, "RUN-WEB").run()
    assert result.published, result.error
    return data_paths


def test_healthz_without_generation_is_unhealthy():
    response = Client().get("/healthz")
    assert response.status_code == 503
    assert response.json()["status"] == "unhealthy"


def test_export_without_generation_is_503():
    response = Client().get("/fedipol_data.json")
    assert response.status_code == 503


def test_healthz_healthy_after_publication(published_generation):
    response = Client().get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert all(body["checks"].values())


def test_export_served_from_active_generation(published_generation):
    response = Client().get("/fedipol_data.json")
    assert response.status_code == 200
    payload = json.loads(b"".join(response.streaming_content))
    assert set(payload) == {"data"}
    for url in FIXTURE_ACCOUNTS:
        assert url in payload["data"]


def test_manifest_endpoint(published_generation):
    response = Client().get("/manifest.json")
    assert response.status_code == 200
    manifest = response.json()
    assert manifest["run_id"] == "RUN-WEB"
    assert manifest["account_count"] == len(FIXTURE_ACCOUNTS)
    assert manifest["status"] == "complete"


def test_health_data_freshness(published_generation):
    response = Client().get("/health/data")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"
    assert response.json()["generation"] == "RUN-WEB"


def test_dashboard_index_served():
    response = Client().get("/")
    assert response.status_code == 200
    assert b"Fediverse Activity Tracker" in b"".join(response.streaming_content)


def test_dashboard_js_served():
    response = Client().get("/js/ui.js")
    assert response.status_code == 200


def test_dashboard_rejects_unknown_and_traversal():
    client = Client()
    assert client.get("/nicht-da.html").status_code == 404
    assert client.get("/../pyproject.toml").status_code == 404


def test_recovery_marks_stale_runs_failed(published_generation, monkeypatch):
    from datetime import timedelta

    from django.utils import timezone

    run = EtlRun.objects.create(run_id="HANGING", trigger="scheduler", pipeline_version="1.0.0")
    EtlRun.objects.filter(run_id="HANGING").update(started_at=timezone.now() - timedelta(hours=5))

    from fedipol.ops.recorder import mark_stale_runs_failed

    assert mark_stale_runs_failed() >= 1
    run.refresh_from_db()
    assert run.status == "failed"


def test_active_generation_singleton_swap(published_generation):
    from fedipol.ops.recorder import activate_generation, get_active_generation

    activate_generation("GEN-2", "RUN-WEB")
    assert get_active_generation() == "GEN-2"
    solo = ActiveGeneration.get_solo()
    assert solo.previous_generation_id == "RUN-WEB"
    assert ActiveGeneration.objects.count() == 1
