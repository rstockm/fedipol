"""Bruecke zwischen ETL und SQLite-Betriebsmodell (Django ORM)."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from fedipol.ops.models import ActiveGeneration, EtlRun, EtlStep

logger = logging.getLogger(__name__)


def create_run(run_id: str, trigger: str, pipeline_version: str) -> EtlRun:
    return EtlRun.objects.create(
        run_id=run_id,
        trigger=trigger,
        pipeline_version=pipeline_version,
    )


def record_step(run_id: str, step_name: str, attempt: int = 1) -> EtlStep:
    run = EtlRun.objects.get(run_id=run_id)
    return EtlStep.objects.create(run=run, step_name=step_name, attempt=attempt)


def finish_step(step: EtlStep, status: str, *, error_category: str = "",
                input_count: int | None = None, output_count: int | None = None) -> None:
    step.status = status
    step.finished_at = timezone.now()
    step.error_category = error_category
    if input_count is not None:
        step.input_count = input_count
    if output_count is not None:
        step.output_count = output_count
    step.save(update_fields=["status", "finished_at", "error_category", "input_count", "output_count"])


def finish_run(run_id: str, status: str, *, error_summary: str = "",
               published_generation: str = "", account_count: int | None = None,
               fresh_count: int | None = None, stale_count: int | None = None) -> None:
    run = EtlRun.objects.get(run_id=run_id)
    run.status = status
    run.finished_at = timezone.now()
    run.error_summary = error_summary
    run.published_generation = published_generation
    run.account_count = account_count
    run.fresh_count = fresh_count
    run.stale_count = stale_count
    run.save(update_fields=[
        "status", "finished_at", "error_summary", "published_generation",
        "account_count", "fresh_count", "stale_count",
    ])


@transaction.atomic
def activate_generation(generation_id: str, previous_generation_id: str) -> None:
    ActiveGeneration.objects.update_or_create(
        id=1,
        defaults={
            "generation_id": generation_id,
            "previous_generation_id": previous_generation_id or "",
        },
    )


def get_active_generation() -> str | None:
    active = ActiveGeneration.get_solo()
    return active.generation_id if active else None


def mark_stale_runs_failed(max_age_minutes: int = 240) -> int:
    """Recovery: als 'running' haengengebliebene Laeufe als fehlgeschlagen markieren."""
    cutoff = timezone.now() - timedelta(minutes=max_age_minutes)
    stale = EtlRun.objects.filter(status=EtlRun.STATUS_RUNNING, started_at__lt=cutoff)
    count = 0
    for run in stale:
        run.status = EtlRun.STATUS_FAILED
        run.finished_at = timezone.now()
        run.error_summary = "Recovery: Lauf ohne Abschluss gefunden (Process-Abbruch)"
        run.save(update_fields=["status", "finished_at", "error_summary"])
        count += 1
    return count


class DjangoRunRecorder:
    """Objektorientierte Fassade fuer die ETL-Orchestrierung."""

    def create_run(self, run_id: str, trigger: str, pipeline_version: str) -> None:
        create_run(run_id, trigger, pipeline_version)

    def record_step(self, run_id: str, step_name: str, attempt: int = 1):  # noqa: ANN201
        return record_step(run_id, step_name, attempt)

    @staticmethod
    def finish_step(step, status: str, **kwargs) -> None:  # noqa: ANN001
        finish_step(step, status, **kwargs)

    def finish_run(self, run_id: str, status: str, **kwargs) -> None:
        finish_run(run_id, status, **kwargs)

    def activate_generation(self, generation_id: str, previous_generation_id: str) -> None:
        activate_generation(generation_id, previous_generation_id)

    def get_active_generation(self) -> str | None:
        return get_active_generation()

    def mark_stale_runs_failed(self, max_age_minutes: int = 240) -> int:
        return mark_stale_runs_failed(max_age_minutes)
