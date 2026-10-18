import json
import logging
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from game_download_manager.pipeline import DownloadPipeline
from game_download_manager.route_decision import GiB, MiB, SwitchToServer, TorrentProbe

MAGNET = "magnet:?xt=urn:btih:" + "a" * 40


def run_probe(total, seeds, speed_bps, seconds=30):
    """Feed the probe one sample per second, like the torrent loop does, and return its first answer."""
    probe = TorrentProbe()
    for second in range(seconds + 1):
        verdict = probe.decide(float(second), total, seeds, int(speed_bps * second))
        if verdict:
            return verdict, second, probe
    return None, seconds, probe


def test_a_small_game_always_stays_with_the_player_at_once():
    assert run_probe(4 * GiB, seeds=0, speed_bps=0)[:2] == ("keep", 0)


def test_a_well_seeded_big_game_stays_with_the_player_at_once():
    assert run_probe(40 * GiB, seeds=25, speed_bps=0)[:2] == ("keep", 0)


def test_a_big_game_that_already_downloads_fast_stays_after_measuring():
    verdict, second, _ = run_probe(40 * GiB, seeds=3, speed_bps=8 * MiB)
    assert verdict == "keep" and second == 20


def test_a_big_slow_game_goes_to_the_server_after_measuring():
    verdict, second, probe = run_probe(40 * GiB, seeds=3, speed_bps=1 * MiB)
    assert verdict == "server" and second == 20
    assert "40.0 GB" in probe.reason and "3 fuentes" in probe.reason


# ------------------------------------------------------------------ the route inside the pipeline

class Ctx:
    def __init__(self):
        self.cancelled = threading.Event()
        self.logger = logging.getLogger("test-route")

    def emit_progress(self, *args, **kwargs):
        pass


class FakeChunks:
    def __init__(self, where=""):
        self.where, self.downloads = where, []

    def peek(self, source):
        return self.where

    def download(self, source, *rest):
        self.downloads.append(source)
        return "C:/games/from-server"


def pipeline(torrent, chunks):
    p = DownloadPipeline(Ctx(), watch_controls=None, cleanup_on_cancel=None, download_http=None,
                         download_torrent=torrent, extract_archives=None)
    p.chunked = lambda session: chunks
    return p


@pytest.fixture()
def plus(monkeypatch):
    monkeypatch.setenv("GAMEACCESS_CHUNK_SESSION", json.dumps({"api": "https://api", "token": "t", "installation": "i"}))


ARGS = SimpleNamespace(source_delivery="download")


def test_a_torrent_the_server_already_holds_is_streamed_from_it(plus):
    chunks = FakeChunks(where="torbox")
    p = pipeline(lambda **kw: pytest.fail("the torrent must not start"), chunks)
    assert p.server_or_torrent(ARGS, MAGNET, True, "d", "1", "G") == ("C:/games/from-server", None, False)


def test_a_torrent_worth_downloading_directly_stays_with_the_player(plus):
    chunks = FakeChunks()

    def torrent(probe, **kw):
        assert probe(0.0, 2 * GiB, 1, 0) == "keep"
        return "C:/games/from-torrent"

    assert pipeline(torrent, chunks).server_or_torrent(ARGS, MAGNET, True, "d", "1", "G") == (None, "C:/games/from-torrent", False)
    assert chunks.downloads == []


def test_a_slow_big_torrent_is_handed_to_the_server(plus):
    chunks = FakeChunks()

    def torrent(probe, **kw):
        raise SwitchToServer("el torrent no conviene bajarlo directo")

    assert pipeline(torrent, chunks).server_or_torrent(ARGS, MAGNET, True, "d", "1", "G") == ("C:/games/from-server", None, False)
    assert chunks.downloads == [MAGNET]


def test_without_plus_nothing_is_decided_here(monkeypatch):
    monkeypatch.delenv("GAMEACCESS_CHUNK_SESSION", raising=False)
    p = pipeline(lambda **kw: pytest.fail("the caller runs the plain torrent"), FakeChunks(where="viking"))
    assert p.server_or_torrent(ARGS, MAGNET, True, "d", "1", "G") == (None, None, False)
