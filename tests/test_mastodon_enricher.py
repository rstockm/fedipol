"""Tests fuer die Mastodon-Anreicherung: Lookup, Pagination, Cap, Bot-Flag."""
import json
from urllib.parse import urlencode

import fedipol.etl.sources.mastodon as mastodon_module
from fedipol.etl.sources.mastodon import MastodonEnricher


class FakeHttpResponse:
    def __init__(self, payload, headers=None, status=200):
        self.content = json.dumps(payload).encode()
        self.status_code = status
        self.headers = headers or {}

    @property
    def ok(self):
        return 200 <= self.status_code < 300

    @property
    def status(self):
        return self.status_code

    def json(self):
        return json.loads(self.content.decode("utf-8"))


def _fake_fetch(responses):
    calls = []

    def fetch(url, **kwargs):
        calls.append(url)
        item = responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    return fetch, calls


KEYWORDS = ["bot", "automatisiert", "mirror"]


def _enricher(pages_max=3):
    return MastodonEnricher(bot_keywords=KEYWORDS, status_pages_max=pages_max, status_limit=40)


def test_basic_enrichment(monkeypatch):
    lookup = FakeHttpResponse(
        {
            "id": "42",
            "statuses_count": 500,
            "created_at": "2022-01-01T00:00:00.000Z",
            "bot": False,
            "note": "<p>Politischer Account</p>",
        }
    )
    page1 = FakeHttpResponse(
        [{"created_at": "2026-09-01T10:00:00.000Z"}] * 5, headers={"Link": ""}
    )
    fetch, calls = _fake_fetch([lookup, page1])
    monkeypatch.setattr(mastodon_module, "fetch", fetch)

    result = _enricher().enrich("https://gruene.social/@erika/")
    assert result.ok
    assert result.posts_count == 500
    assert result.recent_posts_count == 5
    assert result.is_bot is False
    assert result.capped is False
    assert any("/api/v1/accounts/lookup" in c and "acct=erika" in c for c in calls)


def test_cap_after_max_pages(monkeypatch):
    lookup = FakeHttpResponse({"id": "7", "statuses_count": 9000, "bot": False, "note": ""})

    def page():
        headers = {"Link": f'<https://gruene.social/api/v1/accounts/7/statuses?{urlencode({"limit": 40, "max_id": 100})}>; rel="next"'}
        return FakeHttpResponse(
            [{"created_at": "2026-09-01T10:00:00.000Z"}] * 40, headers=headers
        )

    fetch, _ = _fake_fetch([lookup, page(), page(), page()])
    monkeypatch.setattr(mastodon_module, "fetch", fetch)

    result = _enricher(pages_max=3).enrich("https://gruene.social/@eilig")
    assert result.recent_posts_count == 120
    assert result.capped is True


def test_stops_when_all_posts_too_old(monkeypatch):
    lookup = FakeHttpResponse({"id": "9", "statuses_count": 10, "bot": False, "note": ""})
    old_page = FakeHttpResponse([{"created_at": "2020-01-01T00:00:00.000Z"}], headers={"Link": ""})
    fetch, _ = _fake_fetch([lookup, old_page])
    monkeypatch.setattr(mastodon_module, "fetch", fetch)

    result = _enricher().enrich("https://gruene.social/@inaktiv")
    assert result.recent_posts_count == 0
    assert result.capped is False


def test_bot_flag_from_note_keyword(monkeypatch):
    lookup = FakeHttpResponse(
        {"id": "11", "statuses_count": 3, "bot": False, "note": "<p>Automatisierter Mirror</p>"}
    )
    empty = FakeHttpResponse([], headers={"Link": ""})
    fetch, _ = _fake_fetch([lookup, empty])
    monkeypatch.setattr(mastodon_module, "fetch", fetch)

    result = _enricher().enrich("https://gruene.social/@spiegel")
    assert result.is_bot is True


def test_lookup_404_is_error_not_exception(monkeypatch):
    fetch, _ = _fake_fetch([FakeHttpResponse({}, status=404)])
    monkeypatch.setattr(mastodon_module, "fetch", fetch)

    result = _enricher().enrich("https://gruene.social/@geloescht")
    assert not result.ok
    assert "404" in result.error
