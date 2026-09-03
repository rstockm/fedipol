"""Tests fuer HTTP-Client: Timeouts, Retries, Retry-After."""
import pytest
import requests

from fedipol.etl.http import PermanentFetchError, fetch


class FakeResponse:
    def __init__(self, status, headers=None, content=b"{}"):
        self.status_code = status
        self.headers = headers or {}
        self.content = content


class FakeSession:
    """Programmierbare Antwortfolge."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append({"url": url, "kwargs": kwargs})
        item = self.responses.pop(0) if self.responses else FakeResponse(200)
        if isinstance(item, Exception):
            raise item
        return item


def test_success_first_try():
    session = FakeSession([FakeResponse(200, content=b'{"ok": true}')])
    result = fetch("https://example.org", session=session, sleep=lambda s: None)
    assert result.ok
    assert result.json() == {"ok": True}
    assert result.attempts == 1


def test_retries_on_429_with_retry_after():
    session = FakeSession(
        [FakeResponse(429, {"Retry-After": "0.1"}), FakeResponse(429, {"Retry-After": "0.1"}), FakeResponse(200)]
    )
    sleeps = []
    result = fetch(
        "https://example.org",
        session=session,
        max_retries=3,
        backoff_base=1.0,
        sleep=sleeps.append,
    )
    assert result.ok
    assert result.attempts == 3
    assert len(sleeps) == 2


def test_no_retry_on_404():
    session = FakeSession([FakeResponse(404)])
    with pytest.raises(PermanentFetchError):
        fetch("https://example.org", session=session, max_retries=3, sleep=lambda s: None)
    assert len(session.calls) == 1


def test_network_error_exhausts_retries():
    session = FakeSession([requests.exceptions.ConnectionError("boom")] * 5)
    with pytest.raises(PermanentFetchError):
        fetch("https://example.org", session=session, max_retries=2, backoff_base=0.0, sleep=lambda s: None)
    assert len(session.calls) == 3  # erster Versuch + 2 Retries


def test_timeout_kwargs_are_passed():
    session = FakeSession([FakeResponse(200)])
    fetch(
        "https://example.org",
        session=session,
        connect_timeout=1.5,
        read_timeout=2.5,
        sleep=lambda s: None,
    )
    kwargs = session.calls[0]["kwargs"]
    assert kwargs["timeout"] == (1.5, 2.5)
