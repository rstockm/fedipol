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
