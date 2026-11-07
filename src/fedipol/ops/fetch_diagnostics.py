"""Read-only collection diagnostics, independent of publication success."""
from collections import Counter

from django.utils import timezone

from fedipol.ops.models import AccountFetchAttempt, AccountFetchState, EtlRun, InstanceFetchState


def collection_status(run_id=None, instance=None):
    if run_id is None:
        latest = EtlRun.objects.first()
        run_id = latest.run_id if latest else None
    attempts = AccountFetchAttempt.objects.filter(run_id=run_id).order_by("finished_at", "event_id")
    accounts = AccountFetchState.objects.filter(active=True)
    instances = InstanceFetchState.objects.all()
    if instance:
        accounts = accounts.filter(instance=instance)
        urls = accounts.values_list("url", flat=True)
        attempts = attempts.filter(url__in=urls)
        instances = instances.filter(host=instance)
    latest_by_url = {}
    request_count = retry_count = 0
    errors = Counter()
    for attempt in attempts:
        latest_by_url[attempt.url] = attempt
        request_count += attempt.request_count
        retry_count += attempt.retry_count
        if attempt.error_category:
            errors[attempt.error_category] += 1
    oldest = accounts.filter(last_success_at__isnull=False).order_by("last_success_at").first()
    run = EtlRun.objects.filter(run_id=run_id).first()
    instance_states = {row.host: row.state for row in instances}
    return {
        "run_id": run_id, "run_status": run.status if run else None,
        "accounts": len(latest_by_url), "outcomes": dict(Counter(a.outcome for a in latest_by_url.values())),
        "requests": request_count, "retries": retry_count, "error_events": dict(errors),
        "oldest_success_at": oldest.last_success_at.isoformat() if oldest else None,
        "oldest_age_seconds": max(0, (timezone.now()-oldest.last_success_at).total_seconds()) if oldest else None,
        "never_successful": accounts.filter(last_success_at__isnull=True).count(),
        "review_required": accounts.filter(review_required=True).count(),
        "instance_requests": sum(s.get("requests_in_run", 0) for s in instance_states.values()
                                 if s.get("last_run_id") == run_id),
        "instances": instance_states,
    }
