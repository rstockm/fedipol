"""Taeglicher ETL-Lauf: python manage.py run_fedipol_etl"""

import logging

from django.core.management.base import BaseCommand

from fedipol.etl.pipeline import Pipeline, PipelineConfig
from fedipol.ops.recorder import DjangoRunRecorder

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Fuehrt den vollstaendigen fedipol ETL-Lauf aus und veroeffentlicht eine neue Generation."

    def add_arguments(self, parser):
        parser.add_argument(
            "--trigger",
            default="scheduler",
            choices=["scheduler", "manual", "test"],
            help="Ausloeser des Laufs (Protokollierung)",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Entwicklungsmodus: nur N Accounts anreichern",
        )
        parser.add_argument(
            "--offline",
            action="store_true",
            help="Keine externen Abrufe; verwendet vorhandene Checkpoints (Tests)",
        )
        parser.add_argument(
            "--wikidata-offline",
            action="store_true",
            help="Nur Wikidata aus Fixtures; Instanzen und Mastodon live abfragen",
        )

    def handle(self, *args, **options):
        pipeline = Pipeline(
            recorder=DjangoRunRecorder(),
            config=PipelineConfig(
                trigger=options["trigger"],
                limit=options["limit"],
                offline=options["offline"],
                wikidata_offline=options["wikidata_offline"],
            ),
        )
        result = pipeline.run()
        if not result.published:
            self.stderr.write(self.style.ERROR(f"Lauf {result.run_id} nicht veroeffentlicht: {result.error}"))
            raise SystemExit(1)
        self.stdout.write(
            self.style.SUCCESS(
                f"Lauf {result.run_id} veroeffentlicht: "
                f"{result.account_count} Accounts "
                f"({result.fresh_count} frisch, {result.stale_count} veraltet, "
                f"{result.missing_count} ohne Beobachtung)"
            )
        )
        for warning in result.warnings:
            self.stdout.write(self.style.WARNING(f"Hinweis: {warning}"))
