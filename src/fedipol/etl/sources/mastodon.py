"""Mastodon-Account-Anreicherung: Lookup plus Statuspagination (Aktivitaet 60 Tage)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from fedipol.etl.http import PermanentFetchError, fetch
from fedipol.etl.normalize import canonical_url, is_bot_note
from fedipol.etl.rate_limit import DeferredRequest

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
    phase: str = ""
    error_category: str = ""
    http_status: int | None = None
    request_count: int = 0
    retry_count: int = 0
    deferred: bool = False
    deferred_until: float | None = None

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
        limiter=None,
    ) -> None:
        self.bot_keywords = bot_keywords
        self.connect_timeout = connect_timeout
        self.read_timeout = read_timeout
        self.max_retries = max_retries
        self.status_pages_max = status_pages_max
        self.status_limit = status_limit
        self.limiter = limiter

    def enrich(self, account_url: str, *, now: datetime | None = None) -> EnrichmentResult:
        url = canonical_url(account_url)
        host = urlsplit(url).hostname
        username = urlsplit(url).path.rsplit("/", 1)[-1].lstrip("@")
        if not host or not username:
            return EnrichmentResult(url=url, error=f"ungueltige Account-URL: {account_url}")

        now = now or datetime.now(UTC)
        cutoff = now - timedelta(days=60)

        requests_made = 0
        retries = 0

        def request(target):
            nonlocal requests_made, retries
            try:
                response = fetch(
                    target, connect_timeout=self.connect_timeout, read_timeout=self.read_timeout,
                    max_retries=self.max_retries, **({"limiter": self.limiter} if self.limiter else {}),
                )
            except (PermanentFetchError, DeferredRequest) as exc:
                count = getattr(exc, "attempts", 0 if isinstance(exc, DeferredRequest) else 1)
                requests_made += count
                retries += max(count-1, 0)
                raise
            count = getattr(response, "attempts", 1)
            requests_made += count
            retries += max(count-1, 0)
            return response

        def failure(phase, exc=None, *, status=None, category="invalid_response"):
            deferred = isinstance(exc, DeferredRequest)
            code = getattr(exc, "status", status)
            reason = getattr(exc, "reason", getattr(exc, "category", category))
            return EnrichmentResult(
                url=url, error=f"{phase}: {reason}" + (f" (HTTP {code})" if code else ""),
                phase=phase, error_category=reason, http_status=code,
                request_count=requests_made, retry_count=retries, deferred=deferred,
                deferred_until=exc.until if deferred else None, fetched_at=_iso(),
            )

        try:
            lookup_url = f"https://{host}/api/v1/accounts/lookup?acct={username}"
            lookup = request(lookup_url)
        except (PermanentFetchError, DeferredRequest) as exc:
            return failure("lookup", exc)
        if not lookup.ok:
            return failure("lookup", status=lookup.status, category="http_error")
        try:
            profile = lookup.json()
        except ValueError:
            return failure("lookup")

        if not isinstance(profile, dict):
            return failure("lookup")
        account_id = profile.get("id")
        if (not isinstance(account_id, (str, int)) or isinstance(account_id, bool)
                or not str(account_id).isalnum()
                or not isinstance(profile.get("statuses_count"), int)
                or isinstance(profile.get("statuses_count"), bool) or profile["statuses_count"] < 0):
            return failure("lookup")

        recent = 0
        capped = False
        next_url: str | None = (
            f"https://{host}/api/v1/accounts/{account_id}/statuses?limit={self.status_limit}"
        )
        has_more = False
        for _ in range(self.status_pages_max):
            try:
                page = request(next_url)
            except (PermanentFetchError, DeferredRequest) as exc:
                return failure("statuses", exc)
            if not page.ok:
                return failure("statuses", status=page.status, category="http_error")
            try:
                statuses = page.json()
            except ValueError:
                return failure("statuses")
            if not isinstance(statuses, list):
                return failure("statuses")
            if not statuses:
                break
            all_too_old = True
            for status in statuses:
                if not isinstance(status, dict) or _parse_created(status.get("created_at")) is None:
                    return failure("statuses")
                created = _parse_created(status.get("created_at"))
                if created is not None and created >= cutoff:
                    recent += 1
                    all_too_old = False
            if all_too_old:
                break
            next_url = _next_link(page.headers.get("Link", ""))
            if not next_url:
                break
            next_target = urlsplit(next_url)
            if (next_target.scheme != "https" or next_target.netloc != host
                    or next_target.path != f"/api/v1/accounts/{account_id}/statuses"
                    or next_target.fragment):
                return failure("statuses", category="unsafe_pagination")
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
            request_count=requests_made,
            retry_count=retries,
        )


def _bot_flag(profile: dict, keywords: list[str]) -> bool:
    if profile.get("bot") is True:
        return True
    return is_bot_note(str(profile.get("note") or ""), keywords)


def _parse_created(value) -> datetime | None:  # noqa: ANN001
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else None
    except ValueError:
        return None


def _next_link(link_header: str) -> str | None:
    for part in link_header.split(","):
        if 'rel="next"' in part:
            return part.split(";")[0].strip().lstrip("<").rstrip(">")
    return None


def _iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
