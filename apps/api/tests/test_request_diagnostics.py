import asyncio
import logging
from types import SimpleNamespace
from app.request_diagnostics import detail, trace_request, _current


def request(path="/digital/catalog"):
    return SimpleNamespace(url=SimpleNamespace(path=path), method="GET")


def test_success_does_not_flush_debug_and_releases_request_context(caplog):
    async def respond(_):
        for step in range(10000):
            detail("step=%s", step)
        assert len(_current.get()) == 10001
        return SimpleNamespace(status_code=200)
    with caplog.at_level(logging.DEBUG, logger="gameaccess.request"):
        asyncio.run(trace_request(request(), respond))
    assert _current.get() is None
    assert not any("step=" in record.message for record in caplog.records)
    assert any("completed" in record.message for record in caplog.records)


def test_failure_flushes_all_detail_even_with_info_logger_threshold(caplog):
    async def respond(_):
        for step in range(10000):
            detail("step=%s", step)
        return SimpleNamespace(status_code=503)
    with caplog.at_level(logging.DEBUG, logger="gameaccess.request"):
        logging.getLogger("gameaccess.request").setLevel(logging.INFO)
        asyncio.run(trace_request(request(), respond))
    steps = [record.message for record in caplog.records if "step=" in record.message]
    assert len(steps) == 10000
    assert steps[0].endswith("step=0")
    assert steps[-1].endswith("step=9999")
    assert _current.get() is None


def test_concurrent_request_contexts_do_not_mix(caplog):
    async def good(_):
        detail("successful-private-detail")
        await asyncio.sleep(0)
        return SimpleNamespace(status_code=200)
    async def bad(_):
        detail("failed-detail")
        await asyncio.sleep(0)
        raise RuntimeError("fixture")
    async def exercise():
        await asyncio.gather(trace_request(request(), good), trace_request(request(), bad), return_exceptions=True)
    with caplog.at_level(logging.DEBUG, logger="gameaccess.request"):
        asyncio.run(exercise())
    assert "successful-private-detail" not in caplog.text
    assert "failed-detail" in caplog.text
