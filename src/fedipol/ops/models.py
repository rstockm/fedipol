"""Betriebsmodelle: ETL-Laeufe, Schritte und die aktive Daten-Generation.

SQLite bewahrt hier ausschliesslich operativen Zustand. Analytische
Accountdaten liegen in den unveraenderlichen DuckDB-Generationen.
"""

from django.db import models


class EtlRun(models.Model):
    """Ein vollstaendiger oder fehlgeschlagener ETL-Lauf."""

    STATUS_RUNNING = "running"
    STATUS_SUCCEEDED = "succeeded"
    STATUS_FAILED = "failed"

    STATUS_CHOICES = [
        (STATUS_RUNNING, "laufend"),
        (STATUS_SUCCEEDED, "erfolgreich"),
        (STATUS_FAILED, "fehlgeschlagen"),
    ]

    TRIGGER_CHOICES = [
        ("scheduler", "Scheduler"),
        ("manual", "Manuell"),
        ("test", "Test"),
    ]

    run_id = models.CharField(max_length=64, unique=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_RUNNING)
    trigger = models.CharField(max_length=16, choices=TRIGGER_CHOICES, default="scheduler")
    pipeline_version = models.CharField(max_length=32)
    previous_generation = models.CharField(max_length=64, blank=True)
    published_generation = models.CharField(max_length=64, blank=True)
    account_count = models.IntegerField(null=True, blank=True)
    fresh_count = models.IntegerField(null=True, blank=True)
    stale_count = models.IntegerField(null=True, blank=True)
    error_summary = models.TextField(blank=True)

    class Meta:
        ordering = ["-started_at"]
        verbose_name = "ETL-Lauf"
        verbose_name_plural = "ETL-Laeufe"

    def __str__(self) -> str:
        return f"{self.run_id} ({self.status})"


class EtlStep(models.Model):
    """Ein Schritt innerhalb eines Laufs, inklusive Wiederholungen."""

    run = models.ForeignKey(EtlRun, on_delete=models.CASCADE, related_name="steps")
    step_name = models.CharField(max_length=64)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, default="running")
    attempt = models.IntegerField(default=1)
    input_count = models.IntegerField(null=True, blank=True)
    output_count = models.IntegerField(null=True, blank=True)
    error_category = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["started_at"]
        verbose_name = "ETL-Schritt"
        verbose_name_plural = "ETL-Schritte"


class ActiveGeneration(models.Model):
    """Singleton: Verweis auf die aktuell veroeffentlichte Generation."""

    generation_id = models.CharField(max_length=64)
    previous_generation_id = models.CharField(max_length=64, blank=True)
    activated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Aktive Generation"
        verbose_name_plural = "Aktive Generationen"

    def __str__(self) -> str:
        return self.generation_id

    @classmethod
    def get_solo(cls) -> "ActiveGeneration | None":
        return cls.objects.select_related(None).first()


class AccountFetchState(models.Model):
    """Operational index only; observation payloads live in the fetch journal."""

    url = models.CharField(max_length=500, primary_key=True)
    instance = models.CharField(max_length=253, db_index=True)
    active = models.BooleanField(default=True)
    first_seen_at = models.DateTimeField()
    last_attempt_at = models.DateTimeField(null=True)
    last_success_at = models.DateTimeField(null=True, db_index=True)
    next_attempt_at = models.DateTimeField(null=True)
    consecutive_failures = models.PositiveIntegerField(default=0)
    not_found_count = models.PositiveIntegerField(default=0)
    first_not_found_at = models.DateTimeField(null=True)
    review_required = models.BooleanField(default=False)
    last_error_category = models.CharField(max_length=64, blank=True)
    observation_ref = models.CharField(max_length=32, blank=True)


class InstanceFetchState(models.Model):
    host = models.CharField(max_length=253, primary_key=True)
    state = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)


class AccountFetchAttempt(models.Model):
    event_id = models.CharField(max_length=32, primary_key=True)
    run_id = models.CharField(max_length=64, db_index=True)
    url = models.CharField(max_length=500, db_index=True)
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField()
    outcome = models.CharField(max_length=16)
    phase = models.CharField(max_length=16, blank=True)
    http_status = models.IntegerField(null=True)
    error_category = models.CharField(max_length=64, blank=True)
    request_count = models.PositiveIntegerField(default=0)
    retry_count = models.PositiveIntegerField(default=0)
    observation_ref = models.CharField(max_length=32, blank=True)


class AppliedFetchEvent(models.Model):
    """Idempotent reconstruction of the SQLite index after process interruption."""

    event_id = models.CharField(max_length=32, primary_key=True)
