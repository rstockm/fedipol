"""Single-writer Django index of validated journal events (never HTTP workers)."""
from datetime import UTC, datetime

from django.db import transaction

from fedipol.ops.models import (
    AccountFetchAttempt,
    AccountFetchState,
    AppliedFetchEvent,
    InstanceFetchState,
)


def _date(value):
    return datetime.fromtimestamp(value, UTC) if value is not None else None


@transaction.atomic
def index_event(store, event):
    _, created = AppliedFetchEvent.objects.get_or_create(event_id=event["id"])
    if not created:
        return
    data = event["data"]
    if event["kind"] == "instance":
        InstanceFetchState.objects.update_or_create(
            host=data["host"], defaults={"state": data["state"]},
        )
        return
    if event["kind"] == "plan":
        AccountFetchState.objects.update(active=False)
        AccountFetchState.objects.filter(url__in=data["urls"]).update(active=True)
        return
    urls = data["urls"] if event["kind"] == "register" else [data["url"]]
    for url in urls:
        fields = {key: _date(value) if key.endswith("_at") else value
                  for key, value in store.accounts[url].items() if key != "url"}
        AccountFetchState.objects.update_or_create(url=url, defaults=fields)
    if event["kind"] == "attempt":
        result = data["result"]
        success = not result.get("error")
        AccountFetchAttempt.objects.create(
            event_id=event["id"], run_id=data["run_id"], url=data["url"],
            started_at=_date(data["started_at"]), finished_at=_date(data["finished_at"]),
            outcome="succeeded" if success else "deferred" if result.get("deferred") else "failed",
            phase=result.get("phase", ""), http_status=result.get("http_status"),
            error_category=result.get("error_category", ""),
            request_count=result.get("request_count", 0), retry_count=result.get("retry_count", 0),
            observation_ref=event["id"] if success else "",
        )
