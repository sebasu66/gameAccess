import io
import logging
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flow_diagnostics import FlowDiagnostics


def capture():
    stream = io.StringIO()
    logger = logging.Logger("transaction-fixture", logging.INFO)
    logger.addHandler(logging.StreamHandler(stream))
    return logger, stream


def test_success_discards_all_detail_without_writing():
    logger, stream = capture()
    flow = FlowDiagnostics(logger, "download", 1)
    for step in range(10000):
        flow.debug("step=%s", step)
    assert flow.pending_count == 10000
    assert stream.getvalue() == ""
    flow.succeed()
    assert flow.pending_count == 0
    flow.fail("late callback")
    assert stream.getvalue() == ""


def test_failure_flushes_complete_ordered_context_once_at_info_log_level():
    logger, stream = capture()
    flow = FlowDiagnostics(logger, "install", 2)
    for step in range(10000):
        flow.debug("step=%s", step)
    flow.fail("extract failed")
    lines = stream.getvalue().splitlines()
    assert len(lines) == 10001
    assert lines[0].endswith("step=0")
    assert lines[-2].endswith("step=9999")
    assert "extract failed" in lines[-1]
    assert flow.pending_count == 0
    flow.fail("duplicate")
    assert len(stream.getvalue().splitlines()) == 10001


def test_parallel_operations_do_not_mix_or_retain_successful_detail():
    logger, stream = capture()
    good = FlowDiagnostics(logger, "download", 3)
    bad = FlowDiagnostics(logger, "download", 4)
    with ThreadPoolExecutor(max_workers=4) as workers:
        list(workers.map(lambda n: (good.debug("good=%s", n), bad.debug("bad=%s", n)), range(200)))
    good.succeed()
    bad.fail("fixture error")
    assert "good=" not in stream.getvalue()
    assert stream.getvalue().count("bad=") == 200
    assert good.pending_count == bad.pending_count == 0


def test_cancel_discards_and_source_credentials_are_redacted_on_failure():
    logger, stream = capture()
    cancelled = FlowDiagnostics(logger, "download", 5)
    cancelled.debug("cancel cleanup")
    cancelled.discard()
    failed = FlowDiagnostics(logger, "download", 6)
    failed.debug("provider=https://user:credential@host/path?token=private password=hidden")
    failed.fail("https://host/private token=secret")
    output = stream.getvalue()
    assert all(value not in output for value in ("cancel cleanup", "credential", "private", "hidden", "token=secret"))
