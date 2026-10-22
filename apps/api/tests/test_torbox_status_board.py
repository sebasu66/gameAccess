import asyncio

import httpx
import pytest

from app import viking_cache_service as service
from app.torbox_status_board import TorboxStatusBoard


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def make_board(items, clock, **kwargs):
    calls = []

    async def fetch(kind):
        calls.append(kind)
        result = items() if callable(items) else items
        if isinstance(result, Exception):
            raise result
        return result

    return TorboxStatusBoard(fetch, clock=clock, **kwargs), calls


def test_many_jobs_share_one_torbox_request_per_interval():
    clock = Clock()
    board, calls = make_board([{"id": n, "download_state": "downloading", "progress": 0.1} for n in range(1, 31)], clock, interval=10)

    async def scenario():
        first = await asyncio.gather(*(board.get("torrent", n) for n in range(1, 31)))
        assert [item["id"] for item in first] == list(range(1, 31))
        for _ in range(50):  # the same jobs keep asking while the interval has not passed
            await asyncio.gather(*(board.get("torrent", n) for n in range(1, 31)))

    asyncio.run(scenario())
    assert calls == ["torrent"]
    clock.now += 10
    asyncio.run(board.get("torrent", 1))
    assert calls == ["torrent", "torrent"]


def test_each_kind_has_its_own_request_and_missing_items_are_none():
    clock = Clock()
    board, calls = make_board([{"id": 1}], clock, interval=10)

    async def scenario():
        assert (await board.get("torrent", 1))["id"] == 1
        assert await board.get("torrent", 99) is None
        await board.get("web", 1)

    asyncio.run(scenario())
    assert calls == ["torrent", "web"]


def test_a_failed_refresh_keeps_the_last_list_until_it_is_too_old():
    clock = Clock()
    state = {"items": [{"id": 1, "download_state": "downloading"}]}
    board, calls = make_board(lambda: state["items"], clock, interval=5, max_stale=60)

    async def get():
        return await board.get("torrent", 1)

    assert asyncio.run(get())["id"] == 1
    state["items"] = service.ProviderFailure("torbox_timeout", 504, "lento")
    clock.now += 5
    assert asyncio.run(get())["id"] == 1  # TorBox hiccup: waiting jobs are not failed
    clock.now += 70
    with pytest.raises(service.ProviderFailure) as failure:
        asyncio.run(get())
    assert failure.value.code == "torbox_timeout"
    state["items"] = [{"id": 1, "download_state": "completed"}]
    clock.now += 5
    assert asyncio.run(get())["download_state"] == "completed"  # and it recovers by itself


def test_summary_counts_what_torbox_is_doing():
    clock = Clock()
    board, _ = make_board([
        {"id": 1, "download_state": "downloading"}, {"id": 2, "download_state": "stalled"},
        {"id": 3, "download_state": "queued"}, {"id": 4, "download_finished": True},
        {"id": 5, "download_state": "cached"}, {"id": 6, "download_state": "metadl"},
    ], clock)
    asyncio.run(board.get("torrent", 1))
    clock.now += 4
    assert board.summary() == {"downloading": 2, "queued": 1, "stalled": 1, "ready": 2, "age_seconds": 4.0}


def torbox_handler(listing, counters):
    def handler(request):
        path = request.url.path
        if path.endswith("/torrents/createtorrent"):
            return httpx.Response(200, json={"success": True, "data": {"torrent_id": 7}})
        if path.endswith("/torrents/mylist"):
            counters["mylist"] += 1
            counters["id_param"] += 1 if "id" in request.url.params else 0
            return httpx.Response(200, json={"success": True, "data": listing()})
        return httpx.Response(404)
    return handler


def provider(handler, **kwargs):
    return service.TorBoxVikingProvider(torbox_api_key="key", viking_user_hash="u", transport=httpx.MockTransport(handler), **kwargs)


async def wait_for(source, **kwargs):
    async with httpx.AsyncClient(transport=source.transport) as client:
        return await source._torbox_submit_and_wait(
            client, source_url="magnet:?xt=urn:btih:" + "a" * 40, source_kind="torrent", source_host="",
            file_name="", request_id="r", installation_id="i", fingerprint="f" * 40, **kwargs,
        )


def test_waiting_asks_for_the_whole_list_not_for_one_item():
    counters = {"mylist": 0, "id_param": 0}
    polls = {"n": 0}

    def listing():
        polls["n"] += 1
        done = polls["n"] >= 3
        return [{"id": 7, "download_state": "completed" if done else "downloading", "download_finished": done,
                 "progress": 1.0 if done else 0.2 * polls["n"], "size": 10}, {"id": 8, "download_state": "downloading"}]

    async def no_wait(seconds):
        return None

    seen = []

    async def on_status(item):
        seen.append(item["progress"])

    source = provider(torbox_handler(listing, counters), poll_interval_seconds=0, sleep_fn=no_wait)
    item = asyncio.run(wait_for(source, on_status=on_status))
    assert item.item_id == 7 and seen == [0.2, 0.4, 1.0]
    assert counters["id_param"] == 0


def test_a_source_with_no_progress_and_no_seeds_is_given_up_with_a_clear_reason():
    counters = {"mylist": 0, "id_param": 0}
    ticks = {"t": 0.0}

    async def sleep(seconds):
        ticks["t"] += 400  # fake time passing: three checks later the stall window is over

    def listing():
        return [{"id": 7, "download_state": "stalled", "progress": 0.0, "seeds": 0}]

    source = provider(torbox_handler(listing, counters), poll_interval_seconds=1, sleep_fn=sleep, stall_seconds=900)
    import time as time_module
    real = time_module.monotonic
    time_module.monotonic = lambda: real() + ticks["t"]
    try:
        with pytest.raises(service.ProviderFailure) as failure:
            asyncio.run(wait_for(source))
    finally:
        time_module.monotonic = real
    assert failure.value.code == "torbox_stalled"
    assert "Nadie está compartiendo" in failure.value.public_message


def test_the_torbox_queue_does_not_count_as_a_stall():
    counters = {"mylist": 0, "id_param": 0}
    ticks = {"t": 0.0, "n": 0}

    async def sleep(seconds):
        ticks["t"] += 400
        ticks["n"] += 1

    def listing():
        finished = ticks["n"] >= 6
        return [{"id": 7, "download_state": "completed" if finished else "queued", "download_finished": finished, "progress": 0.0 if not finished else 1.0, "size": 10}]

    source = provider(torbox_handler(listing, counters), poll_interval_seconds=0, sleep_fn=sleep, stall_seconds=900)
    import time as time_module
    real = time_module.monotonic
    time_module.monotonic = lambda: real() + ticks["t"]
    try:
        assert asyncio.run(wait_for(source)).item_id == 7
    finally:
        time_module.monotonic = real


def test_a_source_torbox_would_need_months_for_is_given_up_after_the_first_minutes():
    counters = {"mylist": 0, "id_param": 0}
    ticks = {"t": 0.0, "n": 0}

    async def sleep(seconds):
        ticks["t"] += 60

    def listing():  # it moves, but at this pace it would take months (TorBox's own ETA)
        ticks["n"] += 1
        return [{"id": 7, "download_state": "downloading", "progress": 0.001 * ticks["n"], "seeds": 1,
                 "eta": 90 * 86400, "download_speed": 2000, "size": 70 * 1024 ** 3}]

    source = provider(torbox_handler(listing, counters), poll_interval_seconds=1, sleep_fn=sleep, stall_seconds=900)
    import time as time_module
    real = time_module.monotonic
    time_module.monotonic = lambda: real() + ticks["t"]
    try:
        with pytest.raises(service.ProviderFailure) as failure:
            asyncio.run(wait_for(source))
    finally:
        time_module.monotonic = real
    assert failure.value.code == "torbox_too_slow"
    assert "unos 3 meses" in failure.value.public_message and "1 fuentes" in failure.value.public_message
    assert 180 <= ticks["t"] <= 420   # not before the grace period, and soon after it


def test_a_source_torbox_fetches_in_reasonable_time_is_not_given_up():
    counters = {"mylist": 0, "id_param": 0}
    ticks = {"t": 0.0}

    async def sleep(seconds):
        ticks["t"] += 60

    def listing():  # half done, one hour left: TorBox is simply working
        return [{"id": 7, "download_state": "downloading", "progress": 0.5, "seeds": 40, "eta": 3600, "size": 10}]

    source = provider(torbox_handler(listing, counters), poll_interval_seconds=1, sleep_fn=sleep,
                      stall_seconds=10 ** 6)  # only the estimate rule is under test
    import time as time_module
    real = time_module.monotonic
    time_module.monotonic = lambda: real() + ticks["t"]
    try:
        with pytest.raises(service.ProviderFailure) as stopped:
            asyncio.run(wait_for(source))
    finally:
        time_module.monotonic = real
    assert stopped.value.code == "torbox_wait_timeout"   # it waited the whole allowed time, never "too slow"
