"""HTTP-Client mit festen Timeouts, begrenzten Retries und Backoff.

Retries nur fuer transiente Fehler: Netzwerkfehler, 429 (inkl.
Retry-After), 500, 502, 503, 504. Andere 4xx werden nicht wiederholt.
"""

from __future__ import annotations

import json
import logging
import random
import time
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib.parse import urlsplit

import requests

from fedipol.etl.rate_limit import DeferredRequest, server_deadline

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class PermanentFetchError(RuntimeError):
    """Dauerhaft fehlgeschlagener Abruf (nicht wiederholbar)."""

    def __init__(self, message, *, status=None, category="network", attempts=1):
        super().__init__(message)
        self.status, self.category, self.attempts = status, category, attempts


@dataclass
class FetchResult:
    url: str
    status: int
    content: bytes
    fetched_at: str
    attempts: int
    headers: requests.structures.CaseInsensitiveDict = field(
        default_factory=requests.structures.CaseInsensitiveDict
    )

    def json(self):  # noqa: ANN201
        return json.loads(self.content.decode("utf-8"))

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def fetch(
    url: str,
    *,
    session: requests.Session | None = None,
    accept: str = "application/json",
    connect_timeout: float = 10.0,
    read_timeout: float = 60.0,
    max_retries: int = 3,
    backoff_base: float = 1.5,
    sleep: callable = time.sleep,  # noqa: ANN003
    method: str = "GET",
    data: dict | None = None,
    limiter=None,
) -> FetchResult:
    """GET/POST mit Timeout- und Retry-Vertrag; wirft PermanentFetchError nach Erschoepfung."""
    sleep = sleep or time.sleep
    own_session = session is None
    session = session or requests.Session()
    attempts = 0

    def _request(target_url: str):  # noqa: ANN202
        request_kwargs = {
            "headers": {
                "Accept": accept,
                "Accept-Encoding": "gzip",
                "User-Agent": "FediPol/2.0 (ETL; +https://github.com/rstockm/fedipol)",
            },
            "timeout": (connect_timeout, read_timeout),
            # Managed API requests must not bypass the target host limiter.
            "allow_redirects": limiter is None,
        }
        if method == "POST":
            return session.post(target_url, data=data, **request_kwargs)
        return session.get(target_url, **request_kwargs)

    try:
        while True:
            attempts += 1
            try:
                with limiter.request(url) if limiter else nullcontext():
                    try:
                        response = _request(url)
                    except requests.RequestException:
                        if limiter:
                            host = urlsplit(url).hostname
                            limiter.feedback(host, None, {})
                            error = DeferredRequest("network", limiter.ready_at(host), host)
                            error.status, error.attempts = None, attempts
                            raise error from None
                        raise
                    if limiter:
                        host = urlsplit(url).hostname
                        limiter.feedback(host, response.status_code, response.headers)
                        if response.status_code in RETRYABLE_STATUS:
                            error = DeferredRequest(
                                "rate_limit" if response.status_code == 429 else "server_error",
                                limiter.ready_at(host), host,
                            )
                            error.status, error.attempts = response.status_code, attempts
                            raise error
            except requests.RequestException as exc:
                if attempts > max_retries:
                    raise PermanentFetchError(
                        f"Netzwerkfehler nach {attempts} Versuchen: {exc}", attempts=attempts,
                    ) from exc
                delay = backoff_base**attempts + random.uniform(0, 0.5)
                logger.warning("Netzwerkfehler %s (Versuch %d): %s - warte %.1fs", url, attempts, exc, delay)
                sleep(delay)
                continue

            if response.status_code == 200:
                return FetchResult(
                    url=getattr(response, "url", None) or url,
                    status=response.status_code,
                    content=response.content,
                    fetched_at=_utcnow_iso(),
                    attempts=attempts,
                    headers=requests.structures.CaseInsensitiveDict(response.headers),
                )

            if response.status_code in RETRYABLE_STATUS and attempts <= max_retries:
                retry_after = response.headers.get("Retry-After")
                if response.status_code == 429 and retry_after:
                    try:
                        delay = max(float(retry_after), 1.0)
                    except ValueError:
                        delay = max(1, server_deadline(response.headers, time.time())-time.time())
                else:
                    delay = backoff_base**attempts + random.uniform(0, 0.5)
                logger.warning(
                    "HTTP %d fuer %s (Versuch %d) - Retry in %.1fs",
                    response.status_code,
                    url,
                    attempts,
                    delay,
                )
                sleep(delay)
                continue

            raise PermanentFetchError(
                f"HTTP {response.status_code} fuer {url}", status=response.status_code,
                category="not_found" if response.status_code in (404, 410) else "http_error",
                attempts=attempts,
            )

    finally:
        if own_session:
            session.close()
