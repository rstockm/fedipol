"""Versionierte Overrides: redaktionelle Korrekturen statt manueller Nacharbeit."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

from fedipol.etl.normalize import canonical_url

logger = logging.getLogger(__name__)

_URL_KEY = re.compile(r"^[a-z0-9_.-]+$")


class OverridesError(ValueError):
    pass


@dataclass(frozen=True)
class AccountOverride:
    url: str
    reason: str
    source: str = ""
    exclude: bool = False
    replaced_by: str | None = None
    force_bot: bool | None = None
    display_name: str | None = None
    category: str | None = None
    canonical_url_override: str | None = None
    expires: date | None = None

    def is_active(self, today: date | None = None) -> bool:
        if self.expires is None:
            return True
        return (today or date.today()) <= self.expires


@dataclass
class OverrideSet:
    entries: list[AccountOverride] = field(default_factory=list)

    def by_url(self) -> dict[str, AccountOverride]:
        return {entry.url: entry for entry in self.entries}


def _parse_entry(raw: dict, index: int) -> AccountOverride:
    if not isinstance(raw, dict):
        raise OverridesError(f"Override #{index}: Eintrag muss ein Mapping sein")
    url = raw.get("url")
    if not url or not isinstance(url, str):
        raise OverridesError(f"Override #{index}: 'url' fehlt")
    reason = raw.get("reason")
    if not reason or not isinstance(reason, str):
        raise OverridesError(f"Override #{index} ({url}): 'reason' fehlt")

    known = {
        "url",
        "reason",
        "source",
        "exclude",
        "replaced_by",
        "force_bot",
        "display_name",
        "category",
        "canonical_url",
        "expires",
    }
    unknown = set(raw) - known
    if unknown:
        raise OverridesError(f"Override #{index} ({url}): unbekannte Felder {sorted(unknown)}")

    expires_raw = raw.get("expires")
    expires = None
    if expires_raw is not None:
        try:
            expires = date.fromisoformat(str(expires_raw))
        except ValueError as exc:
            raise OverridesError(f"Override #{index} ({url}): ungueltiges 'expires'") from exc

    replaced_by = raw.get("replaced_by")
    force_bot = raw.get("force_bot")
    if force_bot is not None and not isinstance(force_bot, bool):
        raise OverridesError(f"Override #{index} ({url}): 'force_bot' muss boolean sein")

    try:
        canon = canonical_url(url)
    except ValueError as exc:
        raise OverridesError(f"Override #{index}: {exc}") from exc

    return AccountOverride(
        url=canon,
        reason=reason,
        source=str(raw.get("source") or ""),
        exclude=bool(raw.get("exclude", False)),
        replaced_by=canonical_url(replaced_by) if replaced_by else None,
        force_bot=force_bot,
        display_name=raw.get("display_name"),
        category=raw.get("category"),
        canonical_url_override=canonical_url(raw["canonical_url"]) if raw.get("canonical_url") else None,
        expires=expires,
    )


def load_overrides(path: Path | None) -> OverrideSet:
    """Laedt und validiert config/account_overrides.yaml."""
    if path is None or not Path(path).is_file():
        return OverrideSet()
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    entries_raw = data.get("accounts")
    if entries_raw is None:
        entries_raw = []
    if not isinstance(entries_raw, list):
        raise OverridesError("'accounts' muss eine Liste sein")
    entries = [_parse_entry(raw, i) for i, raw in enumerate(entries_raw)]
    return OverrideSet(entries=entries)


def validate_against(overrides: OverrideSet, known_urls: set[str]) -> list[str]:
    """Warnungen fuer Overrides, die keine bekannten Accounts treffen."""
    warnings: list[str] = []
    for entry in overrides.entries:
        if entry.url not in known_urls and entry.replaced_by not in known_urls:
            warnings.append(
                f"Override trifft keinen bekannten Account: {entry.url} ({entry.reason})"
            )
    return warnings
