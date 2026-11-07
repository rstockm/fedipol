"""Inspect account outcomes without probing external instances."""
import json

from django.core.management.base import BaseCommand

from fedipol.ops.fetch_diagnostics import collection_status
from fedipol.ops.models import AccountFetchAttempt, AccountFetchState


class Command(BaseCommand):
    help = "Show collection progress, oldest accounts and structured errors (no network calls)"

    def add_arguments(self, parser):
        parser.add_argument("--run-id")
        parser.add_argument("--instance")
        parser.add_argument("--limit", type=int, default=50)

    def handle(self, *args, **options):
        summary = collection_status(options["run_id"], options["instance"])
        accounts = AccountFetchState.objects.filter(active=True)
        errors = AccountFetchAttempt.objects.filter(run_id=summary["run_id"]).exclude(outcome="succeeded")
        if options["instance"]:
            accounts = accounts.filter(instance=options["instance"])
            errors = errors.filter(url__in=accounts.values_list("url", flat=True))
        limit = max(0, min(1000, options["limit"]))
        summary["oldest_accounts"] = list(accounts.order_by("last_success_at", "first_seen_at", "url").values(
            "url", "last_success_at", "next_attempt_at", "last_error_category", "review_required",
        )[:limit])
        summary["errors"] = list(errors.order_by("-finished_at").values(
            "url", "phase", "http_status", "error_category", "request_count", "outcome", "finished_at",
        )[:limit])
        self.stdout.write(json.dumps(summary, ensure_ascii=False, default=str, indent=2))
