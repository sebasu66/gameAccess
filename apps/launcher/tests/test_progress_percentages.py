import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_download_manager import worker as worker


def emitted(phase, percent):
    events = []
    with patch.object(worker, "emit_json", side_effect=events.append):
        worker.emit_progress("620", phase, percent, status_text="x")
    return events[0]


def test_download_and_installation_have_their_own_percentages():
    event = emitted("downloading", 80.0)
    assert (event["downloadPercent"], event["installPercent"], event["progressPercent"]) == (80.0, 0.0, 40.0)


def test_finished_download_does_not_mean_installed():
    event = emitted("decompressing", 25.0)
    assert (event["downloadPercent"], event["installPercent"]) == (100.0, 25.0)


def test_completed_fills_both_and_preparing_clears_both():
    done = emitted("completed", 100.0)
    assert (done["downloadPercent"], done["installPercent"]) == (100.0, 100.0)
    start = emitted("preparing", 22.0)
    assert (start["downloadPercent"], start["installPercent"]) == (0.0, 0.0)
