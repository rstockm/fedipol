"""Dispatch only ready instances; oldest successful observation first per host."""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from urllib.parse import urlsplit

from fedipol.etl.sources.mastodon import EnrichmentResult

logger = logging.getLogger(__name__)


def enrich_fairly(enricher, urls, state, limiter, *, run_id, checkpoint,
                  stopped=lambda: False, max_workers=6, now=time.time, sleep=time.sleep):
    state.register(urls)
    queues = defaultdict(deque)
    results, attempts = {}, defaultdict(int)
    for url in state.ordered(urls):
        queues[urlsplit(url).hostname].append(url)
    for url in set(urls) - {u for queue in queues.values() for u in queue}:
        results[url] = EnrichmentResult(
            url=url, error="not_due", error_category="not_due", deferred=True,
            deferred_until=state.accounts[url]["next_attempt_at"],
        )
    hosts = deque(sorted(queues))
    active = {}
    busy = set()

    def defer(url, host):
        result = EnrichmentResult(
            url=url, error="instance_budget", error_category="instance_budget", deferred=True,
            deferred_until=max(now()+3600, limiter.ready_at(host)),
        )
        state.record(run_id, result, started_at=now())
        results[url] = result

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        while hosts or active:
            state.flush()  # persists worker cooldown events on the single SQLite writer
            if stopped():
                break
            for _ in range(len(hosts)):
                host = hosts.popleft()
                if not queues[host]:
                    if host in busy:
                        hosts.append(host)
                    continue
                if host not in busy:
                    if limiter.exhausted(host) or limiter.ready_at(host) > limiter.expires_at(host):
                        while queues[host]:
                            defer(queues[host].popleft(), host)
                        continue
                    if limiter.ready_at(host) <= now() and len(active) < max_workers:
                        url = queues[host].popleft()
                        active[pool.submit(enricher.enrich, url)] = (host, url, now())
                        busy.add(host)
                hosts.append(host)
            if active:
                completed, _ = wait(active, timeout=0.25, return_when=FIRST_COMPLETED)
                for future in completed:
                    host, url, started_at = active.pop(future)
                    busy.remove(host)
                    try:
                        result = future.result()
                    except Exception:  # unexpected programming errors must not become good data
                        logger.exception("Unexpected enrichment error for %s", url)
                        raise
                    result.retry_count += int(attempts[url] > 0)
                    state.record(run_id, result, started_at=started_at)
                    results[url] = result
                    attempts[url] += 1
                    if result.ok:
                        checkpoint.record(result)
                    elif (result.deferred and attempts[url] < 3 and not limiter.exhausted(host)
                          and (result.deferred_until or now()) < limiter.expires_at(host)):
                        # Oldest remains first; a cooldown never pins a global worker.
                        queues[host].appendleft(url)
            elif hosts:
                delay = min(max(0, limiter.ready_at(h)-now()) for h in hosts)
                sleep(min(max(delay, 0.01), 1.0))
        # Finish already running bounded requests even after SIGTERM; retain results.
        for future, (_host, url, started_at) in list(active.items()):
            result = future.result()
            state.record(run_id, result, started_at=started_at)
            results[url] = result
            if result.ok:
                checkpoint.record(result)
    state.flush()
    return list(results.values())
