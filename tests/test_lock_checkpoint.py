"""Tests fuer Checkpoints und Interprozess-Lock."""
import threading

import pytest

from fedipol.etl.checkpoint import CheckpointStore
from fedipol.etl.locking import FileLock, LockBusy
from fedipol.etl.sources.mastodon import EnrichmentResult


def test_checkpoint_roundtrip(tmp_path):
    store = CheckpointStore(tmp_path / "run.jsonl")
    result = EnrichmentResult(
        url="https://gruene.social/@a",
        posts_count=10,
        recent_posts_count=2,
        created_at="2022-01-01T00:00:00.000Z",
        is_bot=False,
        fetched_at="2026-09-03T02:00:00+00:00",
    )
    store.record(result)
    assert store.completed("https://gruene.social/@a")

    reopened = CheckpointStore(tmp_path / "run.jsonl")
    assert reopened.count() == 1
    entry = reopened.get("https://gruene.social/@a")
    assert entry["posts_count"] == 10


def test_checkpoint_skips_errors(tmp_path):
    store = CheckpointStore(tmp_path / "run.jsonl")
    store.record(EnrichmentResult(url="https://x.social/@err", error="HTTP 404"))
    assert not store.completed("https://x.social/@err")


def test_checkpoint_tolerates_partial_line(tmp_path):
    path = tmp_path / "run.jsonl"
    path.write_text(
        '{"url": "https://x.social/@ok", "posts_count": 1, "recent_posts_count": 0, '
        '"created_at": null, "is_bot": false, "capped": false, "fetched_at": null}\n'
        '{"url": "https://x.social/par',
        encoding="utf-8",
    )
    store = CheckpointStore(path)
    assert store.completed("https://x.social/@ok")


def test_file_lock_exclusive(tmp_path):
    lock_path = tmp_path / "etl.lock"
    first = FileLock(lock_path)
    first.acquire()
    try:
        second = FileLock(lock_path)
        with pytest.raises(LockBusy):
            second.acquire()
    finally:
        first.release()

    # Nach Freigabe ist der Lock wieder verfuegbar
    third = FileLock(lock_path)
    third.acquire()
    third.release()


def test_file_lock_threadsafe(tmp_path):
    lock_path = tmp_path / "etl.lock"
    acquired_second: list[bool] = []

    holder = FileLock(lock_path)
    holder.acquire()

    def try_acquire():
        try:
            FileLock(lock_path).acquire()
            acquired_second.append(True)
        except LockBusy:
            acquired_second.append(False)

    thread = threading.Thread(target=try_acquire)
    thread.start()
    thread.join()
    assert acquired_second == [False]
    holder.release()
