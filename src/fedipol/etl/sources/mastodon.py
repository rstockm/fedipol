"""Mastodon-Account-Anreicherung: Lookup plus Statuspagination (Aktivitaet 60 Tage)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from fedipol.etl.http import PermanentFetchError, fetch
from fedipol.etl.normalize import canonical_url, is_bot_note

logger = logging.getLogger(__name__)


@dataclass
class EnrichmentResult:
    url: str
    posts_count: int | None = None
    recent_posts_count: int | None = None
    created_at: str | None = None
    is_bot: bool | None = None
    capped: bool = False
    error: str | None = None
    fetched_at: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.posts_count is not None


class MastodonEnricher:
    """Instanzbewusste Anreicherung einzelner Accounts (Kompatibilitaetsmodus).

    Der Modus entspricht dem bisherigen Verhalten: hoechstens
    `status_pages_max` Seiten mit je 40 Statusmeldungen werden gelesen,
    `recent_posts_count` ist damit effektiv auf 120 gedeckelt (`capped`).
    """

    def __init__(
        self,
        *,
        bot_keywords: list[str],
        connect_timeout: float = 10.0,
        read_timeout: float = 60.0,
        max_retries: int = 3,
        status_pages_max: int = 3,
        status_limit: int = 40,
    ) -> None:
        self.bot_keywords = bot_keywords
        self.connect_timeout = connect_timeout
        self.read_timeout = read_timeout
        self.max_retries = max_retries
        self.status_pages_max = status_pages_max
        self.status_limit = status_limit

    def enrich(self, account_url: str, *, now: datetime | None = None) -> EnrichmentResult:
        url = canonical_url(account_url)
        host = urlsplit(url).hostname
        username = urlsplit(url).path.rsplit("/", 1)[-1].lstrip("@")
        if not host or not username:
            return EnrichmentResult(url=url, error=f"ungueltige Account-URL: {account_url}")

        now = now or datetime.now(UTC)
        cutoff = now - timedelta(days=60)

        try:
            lookup_url = f"https://{host}/api/v1/accounts/lookup?acct={username}"
            lookup = fetch(
                lookup_url,
                connect_timeout=self.connect_timeout,
                read_timeout=self.read_timeout,
                max_retries=self.max_retries,
            )
        except PermanentFetchError as exc:
            return EnrichmentResult(url=url, error=str(exc), fetched_at=_iso())
        if not lookup.ok:
            return EnrichmentResult(
                url=url, error=f"HTTP {lookup.status} (lookup)", fetched_at=_iso()
            )
        try:
            profile = lookup.json()
        except ValueError as exc:
            return EnrichmentResult(url=url, error=f"ungueltiges JSON: {exc}", fetched_at=_iso())

        account_id = profile.get("id")
        if account_id is None:
            return EnrichmentResult(url=url, error="lookup ohne id", fetched_at=_iso())

        recent = 0
        capped = False
        next_url: str | None = (
            f"https://{host}/api/v1/accounts/{account_id}/statuses?limit={self.status_limit}"
        )
        has_more = False
        for _ in range(self.status_pages_max):
            try:
                page = fetch(
                    next_url,
                    connect_timeout=self.connect_timeout,
                    read_timeout=self.read_timeout,
                    max_retries=self.max_retries,
                )
            except PermanentFetchError as exc:
                return EnrichmentResult(
                    url=url,
                    posts_count=profile.get("statuses_count"),
                    recent_posts_count=recent,
                    created_at=profile.get("created_at"),
                    is_bot=_bot_flag(profile, self.bot_keywords),
                    capped=capped,
                    error=f"status-pagination: {exc}",
                    fetched_at=_iso(),
                )
            if not page.ok:
                break
            try:
                statuses = page.json()
            except ValueError:
                break
            if not isinstance(statuses, list) or not statuses:
                break
            all_too_old = True
            for status in statuses:
                created = _parse_created(status.get("created_at"))
                if created is not None and created >= cutoff:
                    recent += 1
                    all_too_old = False
            if all_too_old:
                break
            next_url = _next_link(page.headers.get("Link", ""))
            if not next_url:
                break
        else:
            # Alle erlaubten Seiten gelesen und es gibt weitere: Zaehlung gedeckelt.
            has_more = True

        capped = has_more

        return EnrichmentResult(
            url=url,
            posts_count=profile.get("statuses_count"),
            recent_posts_count=recent,
            created_at=profile.get("created_at"),
            is_bot=_bot_flag(profile, self.bot_keywords),
            capped=capped,
            fetched_at=_iso(),
        )


def _bot_flag(profile: dict, keywords: list[str]) -> bool:
    if profile.get("bot") is True:
        return True
    return is_bot_note(str(profile.get("note") or ""), keywords)


def _parse_created(value) -> datetime | None:  # noqa: ANN001
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _next_link(link_header: str) -> str | None:
    for part in link_header.split(","):
        if 'rel="next"' in part:
            return part.split(";")[0].strip().lstrip("<").rstrip(">")
    return None


def _iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
