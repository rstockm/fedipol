"""Deterministische Tests: Altersprioritaet, Request-Limits und Recovery."""
from datetime import UTC, datetime

import pytest

from fedipol.etl.fetch_state import FetchJournal, FetchState
from fedipol.etl.rate_limit import DeferredRequest, InstanceLimiter
from fedipol.etl.sources.mastodon import EnrichmentResult


class Clock:
    def __init__(self):
        self.value = datetime(2026, 11, 7, tzinfo=UTC).timestamp()

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


def success(url, when):
    return EnrichmentResult(url=url, posts_count=10, recent_posts_count=2,
                            created_at="2020-01-01T00:00:00Z", is_bot=False,
                            fetched_at=datetime.fromtimestamp(when, UTC).isoformat())


def test_oldest_success_first_and_failed_attempt_does_not_refresh(tmp_path):
    state = FetchState(FetchJournal(tmp_path), now=lambda: 1000)
    a, b, new = ["https://gruene.social/@" + name for name in ["a", "b", "new"]]
    state.register([a, b, new])
    state.record("one", success(a, 100), started_at=100)
    state.record("one", success(b, 200), started_at=200)
    state.record("two", EnrichmentResult(url=a, error="lookup failed", error_category="network"), started_at=900)
    assert state.accounts[a]["last_success_at"] == 100
    assert state.accounts[a]["next_attempt_at"] > 1000
    assert state.ordered([b, a, new], now=10000) == [new, a, b]


def test_success_survives_unpublished_run_and_partial_journal(tmp_path):
    clock = Clock()
    journal = FetchJournal(tmp_path)
    state = FetchState(journal, now=clock.now)
    url = "https://social.bund.de/@test"
    state.record("failed-publication", success(url, clock.now()), started_at=clock.now())
    with journal.path.open("ab") as stream:
        stream.write(b'{"incomplete":')
    restored = FetchState(FetchJournal(tmp_path), now=clock.now)
    assert restored.observations()[0]["url"] == url
    assert restored.accounts[url]["last_success_at"] == clock.now()
    # A new append after recovery must not join onto the truncated record.
    restored.record("next", success(url, clock.now()+5), started_at=clock.now())
    assert len(list(FetchJournal(tmp_path).events())) == 2


def test_corrupt_checksum_is_not_a_success(tmp_path):
    journal = FetchJournal(tmp_path)
    state = FetchState(journal)
    state.record("r", success("https://gruene.social/@a", 100), started_at=100)
    journal.path.write_text(journal.path.read_text().replace('"posts_count":10', '"posts_count":99'))
    assert not FetchState(FetchJournal(tmp_path)).observations()


def test_every_request_shares_host_spacing_and_budget():
    clock = Clock()
    limiter = InstanceLimiter(now=clock.now, sleep=clock.sleep,
                              policies={"gruene.social": {"interval": 5, "max_requests": 3}})
    url = "https://gruene.social/api/v1/accounts/1/statuses"
    starts = []
    for _ in range(3):
        with limiter.request(url):
            starts.append(clock.now())
    assert starts == [starts[0], starts[0]+5, starts[0]+10]
    with pytest.raises(DeferredRequest, match="request_budget"):
        with limiter.request(url):
            pass


@pytest.mark.parametrize("header", ["120", "Sat, 07 Nov 2026 00:02:00 GMT"])
def test_429_pauses_entire_host_and_survives_restart(tmp_path, header):
    clock = Clock()
    state = FetchState(FetchJournal(tmp_path), now=clock.now)
    limiter = InstanceLimiter(now=clock.now, sleep=clock.sleep, persist=state.instance_event)
    limiter.feedback("gruene.social", 429, {"Retry-After": header})
    cooldown = limiter.ready_at("gruene.social")
    assert cooldown >= clock.now()+120
    restored = FetchState(FetchJournal(tmp_path), now=clock.now)
    next_limiter = InstanceLimiter(now=clock.now, sleep=clock.sleep, states=restored.instances)
    assert next_limiter.ready_at("gruene.social") == cooldown
    with pytest.raises(DeferredRequest):
        with next_limiter.request("https://gruene.social/api/v1/accounts/lookup"):
            pass
    with next_limiter.request("https://social.bund.de/api/v1/accounts/lookup"):
        pass


def test_header_reset_and_long_retry_after_are_never_shortened():
    clock = Clock()
    limiter = InstanceLimiter(now=clock.now, sleep=clock.sleep)
    limiter.feedback("gruene.social", 429, {"Retry-After": "7200"})
    assert limiter.ready_at("gruene.social") >= clock.now()+7200
    limiter.feedback("social.bund.de", 200, {
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": datetime.fromtimestamp(clock.now()+300, UTC).isoformat(),
    })
    assert limiter.ready_at("social.bund.de") >= clock.now()+300


def test_invalid_headers_back_off_and_success_never_clears_cooldown():
    clock = Clock()
    limiter = InstanceLimiter(now=clock.now, sleep=clock.sleep)
    limiter.feedback("gruene.social", 429, {"Retry-After": "garbage"})
    deadline = limiter.ready_at("gruene.social")
    assert deadline >= clock.now()+60
    limiter.feedback("gruene.social", 200, {})
    assert limiter.ready_at("gruene.social") >= deadline


def test_404_failure_requires_spaced_confirmation(tmp_path):
    clock = Clock()
    state = FetchState(FetchJournal(tmp_path), now=clock.now)
    url = "https://gruene.social/@missing"
    error = EnrichmentResult(url=url, error="not found", http_status=404,
                             error_category="not_found", phase="lookup")
    for day in [0, 1, 8]:
        clock.value = datetime(2026, 11, 7, tzinfo=UTC).timestamp()+day*86400
        state.record(str(day), error, started_at=clock.now())
    assert state.accounts[url]["review_required"] is True
    state.record("recovered", success(url, clock.now()), started_at=clock.now())
    assert state.accounts[url]["review_required"] is False
    assert state.accounts[url]["consecutive_failures"] == 0


def test_ready_instance_is_not_blocked_by_cooling_instance(tmp_path):
    from fedipol.etl.checkpoint import CheckpointStore
    from fedipol.etl.scheduling import enrich_fairly

    clock = Clock()
    state = FetchState(FetchJournal(tmp_path / "journal"), now=clock.now)
    limiter = InstanceLimiter(now=clock.now, sleep=clock.sleep, policies={
        "gruene.social": {"interval": 5, "budget_seconds": 10},
    })
    limiter.feedback("gruene.social", 429, {"Retry-After": "120"})
    calls = []

    class Enricher:
        def enrich(self, url):
            calls.append(url)
            return success(url, clock.now())

    urls = ["https://gruene.social/@old", "https://social.bund.de/@old"]
    results = enrich_fairly(Enricher(), urls, state, limiter, run_id="r",
        checkpoint=CheckpointStore(tmp_path / "checkpoint"), max_workers=1,
        now=clock.now, sleep=clock.sleep)
    assert calls == [urls[1]]
    assert sum(r.ok for r in results) == 1
    assert state.accounts[urls[0]]["last_attempt_at"] is None


def test_dispatch_orders_oldest_and_preserves_new_success_in_next_run(tmp_path):
    from fedipol.etl.checkpoint import CheckpointStore
    from fedipol.etl.scheduling import enrich_fairly

    clock = Clock()
    urls = ["https://gruene.social/@"+name for name in ["newer", "older"]]
    state = FetchState(FetchJournal(tmp_path / "journal"), now=clock.now)
    state.record("seed", success(urls[0], clock.now()-100), started_at=clock.now()-100)
    state.record("seed", success(urls[1], clock.now()-1000), started_at=clock.now()-1000)
    calls = []

    class Enricher:
        def enrich(self, url):
            calls.append(url)
            return success(url, clock.now())

    limiter = InstanceLimiter(now=clock.now, sleep=clock.sleep, policies={"gruene.social": {"interval": 0}})
    enrich_fairly(Enricher(), urls, state, limiter, run_id="not-published",
        checkpoint=CheckpointStore(tmp_path / "checkpoint"), now=clock.now, sleep=clock.sleep)
    assert calls == list(reversed(urls))
    restored = FetchState(FetchJournal(tmp_path / "journal"), now=clock.now)
    assert len(restored.observations()) == 2


def test_journal_reconstructs_django_index_idempotently(tmp_path, db):
    from fedipol.ops.fetch_index import index_event
    from fedipol.ops.models import AccountFetchAttempt, AccountFetchState, InstanceFetchState

    clock = Clock()
    journal = FetchJournal(tmp_path)
    state = FetchState(journal, now=clock.now)
    url = "https://gruene.social/@a"
    state.record("crash-before-sqlite", success(url, clock.now()), started_at=clock.now())
    limiter = InstanceLimiter(now=clock.now, sleep=clock.sleep, persist=state.instance_event)
    limiter.feedback("gruene.social", 429, {"Retry-After": "120"})
    FetchState(FetchJournal(tmp_path), persist=index_event)
    FetchState(FetchJournal(tmp_path), persist=index_event)
    assert AccountFetchAttempt.objects.count() == 1
    account = AccountFetchState.objects.get(url=url)
    assert account.last_success_at.timestamp() == clock.now()
    assert account.observation_ref
    assert InstanceFetchState.objects.get(host="gruene.social").state["cooldown_until"] >= clock.now()+120


def test_post_error_never_overwrites_complete_observation(tmp_path):
    clock = Clock()
    state = FetchState(FetchJournal(tmp_path), now=clock.now)
    url = "https://gruene.social/@a"
    state.record("first", success(url, clock.now()), started_at=clock.now())
    clock.sleep(10)
    state.record("partial", EnrichmentResult(
        url=url, posts_count=100, recent_posts_count=1, error="statuses failed",
        phase="statuses", error_category="invalid_response",
    ), started_at=clock.now())
    assert state.observations()[0]["posts_count"] == 10
    assert state.accounts[url]["last_success_at"] == clock.now()-10


def test_directory_lookup_and_all_status_pages_use_one_limiter(monkeypatch):
    import json

    import fedipol.etl.http as http
    import fedipol.etl.sources.mastodon as mastodon
    from fedipol.etl.sources.mastodon import MastodonEnricher
    from fedipol.etl.sources.mastodon_directory import fetch_instance_directory

    from .test_http import FakeResponse, FakeSession

    clock = Clock()
    session = FakeSession([
        FakeResponse(200, content=json.dumps([{"acct": "a", "url": "https://gruene.social/@a"}]).encode()),
        FakeResponse(200, content=b'{"id":"1","statuses_count":10,"bot":false}'),
        FakeResponse(200, headers={"Link": '<https://gruene.social/api/v1/accounts/1/statuses?max_id=2>; rel="next"'},
                     content=b'[{"created_at":"2026-11-07T00:00:00Z"}]'),
        FakeResponse(200, content=b'[]'),
    ])
    limiter = InstanceLimiter(now=clock.now, sleep=clock.sleep)
    fetch_instance_directory("gruene.social", kind="party", session=session, limiter=limiter)
    monkeypatch.setattr(mastodon, "fetch", lambda url, **kw: http.fetch(url, session=session, **kw))
    result = MastodonEnricher(bot_keywords=[], limiter=limiter).enrich(
        "https://gruene.social/@a", now=datetime(2026, 11, 7, tzinfo=UTC),
    )
    assert result.ok
    assert result.request_count == 3
    assert limiter.counts["gruene.social"] == 4
    assert clock.now() == datetime(2026, 11, 7, tzinfo=UTC).timestamp()+15


def test_stop_during_pacing_does_not_send_another_request():
    clock = Clock()
    stop = [False]
    limiter = InstanceLimiter(now=clock.now, sleep=lambda seconds: stop.__setitem__(0, True),
                              stopped=lambda: stop[0])
    with limiter.request("https://gruene.social/api/v1/accounts/lookup"):
        pass
    with pytest.raises(DeferredRequest):
        with limiter.request("https://gruene.social/api/v1/accounts/1/statuses"):
            pytest.fail("request sent after stop")
    assert limiter.counts["gruene.social"] == 1


def test_instance_budget_is_measured_from_first_request():
    clock = Clock()
    limiter = InstanceLimiter(now=clock.now, sleep=clock.sleep,
                              policies={"gruene.social": {"budget_seconds": 10}})
    with limiter.request("https://gruene.social/api/v1/accounts/lookup"):
        pass
    clock.sleep(11)
    assert limiter.exhausted("gruene.social")
    with pytest.raises(DeferredRequest):
        with limiter.request("https://gruene.social/api/v1/accounts/1/statuses"):
            pytest.fail("request sent after deadline")
