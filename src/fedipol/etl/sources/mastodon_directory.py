"""Import der oeffentlichen Mastodon-Verzeichnisse (Partei- und Institutionsinstanzen)."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fedipol.etl.http import PermanentFetchError, fetch

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DirectoryAccount:
    instance: str
    account_url: str
    name: str
    kind: str  # "party" | "institution"
    party: str | None


def fetch_instance_directory(
    instance: str,
    *,
    kind: str,
    party: str | None = None,
    page_size: int = 80,
    max_accounts: int = 1000,
    connect_timeout: float = 10.0,
    read_timeout: float = 60.0,
    max_retries: int = 3,
    session=None,  # noqa: ANN001
    sleep=None,  # noqa: ANN001
) -> list[DirectoryAccount]:
    """Liest /api/v1/directory einer Instanz paginiert; Fehler werden soft ignoriert."""
    results: list[DirectoryAccount] = []
    offset = 0
    while len(results) < max_accounts:
        url = (
            f"https://{instance}/api/v1/directory"
            f"?local=true&order=active&limit={page_size}&offset={offset}"
        )
        try:
            response = fetch(
                url,
                session=session,
                connect_timeout=connect_timeout,
                read_timeout=read_timeout,
                max_retries=max_retries,
                sleep=sleep,
            )
        except PermanentFetchError as exc:
            logger.warning("Verzeichnisabruf fehlgeschlagen fuer %s: %s", instance, exc)
            break
        if not response.ok:
            break
        try:
            data = response.json()
        except ValueError:
            logger.warning("Ungueltiges JSON im Verzeichnis von %s", instance)
            break
        if not isinstance(data, list) or not data:
            break
        for entry in data:
            acct = entry.get("acct") or entry.get("username") or ""
            display = entry.get("display_name") or ""
            account_url = entry.get("url") or f"https://{instance}/@{acct}"
            name = display.strip() or acct or "Unbekannt"
            results.append(
                DirectoryAccount(
                    instance=instance,
                    account_url=account_url,
                    name=name,
                    kind=kind,
                    party=party,
                )
            )
            if len(results) >= max_accounts:
                break
        if len(data) < page_size:
            break
        offset += page_size
    return results
