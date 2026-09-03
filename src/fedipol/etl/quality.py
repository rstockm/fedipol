"""Qualitaets- und Vertragspruefungen vor der Veroeffentlichung."""

from __future__ import annotations

import logging
import re

from fedipol.etl.export import REQUIRED_ACCOUNT_FIELDS, REQUIRED_TOP_FIELDS

logger = logging.getLogger(__name__)

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")


def check_export(export_result, *, previous_account_count: int | None, limits: dict) -> list[str]:
    """Prueft den Exportvertrag und fachliche Invarianten.

    Liefert eine Liste von Fehlern; eine nicht leere Liste verhindert die
    Veroeffentlichung.
    """
    failures: list[str] = []
    data = export_result.data

    if not data:
        failures.append("Export enthaelt keine Accounts")
        return failures

    for url, entry in data.items():
        if entry["account"]["url"] != url:
            failures.append(f"Schluessel und account.url weichen ab: {url}")
        missing = REQUIRED_TOP_FIELDS - set(entry)
        if missing:
            failures.append(f"{url}: fehlende Felder {sorted(missing)}")
            continue
        missing_acc = REQUIRED_ACCOUNT_FIELDS - set(entry["account"])
        if missing_acc:
            failures.append(f"{url}: fehlende account-Felder {sorted(missing_acc)}")
            continue
        if not isinstance(entry["posts_count"], int) or entry["posts_count"] < 0:
            failures.append(f"{url}: ungueltiger posts_count")
        if not isinstance(entry["recent_posts_count"], int) or entry["recent_posts_count"] < 0:
            failures.append(f"{url}: ungueltiger recent_posts_count")
        if entry["created_at"] is not None and not _ISO_DATE.match(entry["created_at"]):
            failures.append(f"{url}: ungueltiges created_at {entry['created_at']!r}")
        if not isinstance(entry["is_bot"], bool):
            failures.append(f"{url}: is_bot ist kein Boolean")
        if entry["recent_posts_count"] > entry["posts_count"] and entry["posts_count"] > 0:
            failures.append(f"{url}: recent_posts_count uebersteigt posts_count")

    if previous_account_count is not None and previous_account_count > 0:
        drop_share = (previous_account_count - len(data)) / previous_account_count
        if drop_share > limits.get("max_account_drop_share", 0.10):
            failures.append(
                f"Accountzahl bricht um {drop_share:.1%} ein "
                f"({previous_account_count} -> {len(data)})"
            )

    total = export_result.account_count
    if total:
        stale_share = export_result.stale_count / total
        if stale_share > limits.get("max_stale_share", 0.15):
            failures.append(
                f"Anteil veralteter Accounts zu hoch: {stale_share:.1%} "
                f"({export_result.stale_count}/{total})"
            )

    if not export_result.manifest.get("run_id"):
        failures.append("Manifest ohne run_id")

    return failures


def check_freshness_landscape(observations_ok: int, candidates: int, limits: dict) -> list[str]:
    """Ermoeglicht fruehen Abbruch, wenn zu viele Anreicherungen fehlschlagen."""
    failures: list[str] = []
    if candidates == 0:
        failures.append("Keine Accounts zur Anreicherung gefunden")
        return failures
    failure_share = 1 - (observations_ok / candidates)
    if failure_share > limits.get("max_failed_enrichment_share", 0.30):
        failures.append(
            f"{failure_share:.1%} der Account-Anreicherungen fehlgeschlagen "
            f"({candidates - observations_ok}/{candidates})"
        )
    return failures
