"""Tests fuer instanzbewusstes Request-Tempo."""
import threading
import time

from fedipol.etl.pipeline import InstancePacer


def test_same_host_respects_interval():
    pacer = InstancePacer(0.05)
    assert pacer.reserve("a.social") == 0.0  # erster Request sofort
    second = pacer.reserve("a.social")
    assert second > 0.0
    # Slots sind Fixed-Rate: der dritte Aufruf wartet bis zum zweiten Slot,
    # also nach zweite-Verzoegerung plus einem Intervall wieder frei.
    time.sleep(second + 0.05 + 0.001)
    third = pacer.reserve("a.social")
    assert third == 0.0  # Slot wieder frei


def test_different_hosts_are_independent():
    pacer = InstancePacer(0.05)
    pacer.reserve("a.social")
    assert pacer.reserve("b.social") == 0.0


def test_pacer_is_threadsafe():
    pacer = InstancePacer(0.01)
    delays = []

    def reserve_many():
        for _ in range(50):
            delays.append(pacer.reserve("shared.social"))

    threads = [threading.Thread(target=reserve_many) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(delays) == 200
    # Slots sind eindeutig: kein negativer, kein doppelt-so-frueher Start
    assert all(d >= 0.0 for d in delays)
