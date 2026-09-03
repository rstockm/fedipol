"""HTTP-Client mit festen Timeouts, begrenzten Retries und Backoff.

Retries nur fuer transiente Fehler: Netzwerkfehler, 429 (inkl.
Retry-After), 500, 502, 503, 504. Andere 4xx werden nicht wiederholt.
"""

from __future__ import annotations

import json
import logging
import random
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

import requests

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class PermanentFetchError(RuntimeError):
    """Dauerhaft fehlgeschlagener Abruf (nicht wiederholbar)."""


@dataclass
class FetchResult:
    url: str
    status: int
    content: bytes
    fetched_at: str
    attempts: int
    headers: dict = field(default_factory=dict)

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
            "allow_redirects": True,
        }
        if method == "POST":
            return session.post(target_url, data=data, **request_kwargs)
        return session.get(target_url, **request_kwargs)

    try:
        while True:
            attempts += 1
            try:
                response = _request(url)
            except requests.RequestException as exc:
                if attempts > max_retries:
                    raise PermanentFetchError(f"Netzwerkfehler nach {attempts} Versuchen: {exc}") from exc
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
                    headers=dict(response.headers),
                )

            if response.status_code in RETRYABLE_STATUS and attempts <= max_retries:
                retry_after = response.headers.get("Retry-After")
                if response.status_code == 429 and retry_after:
                    try:
                        delay = max(float(retry_after), 1.0)
                    except ValueError:
                        delay = backoff_base**attempts
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

            raise PermanentFetchError(f"HTTP {response.status_code} fuer {url}")

    finally:
        if own_session:
            session.close()
