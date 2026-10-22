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
        self.routes = []

    def set_route(self, route):
        self.routes.append(route)

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
    assert p.context.routes[-1] == "accelerated"


def test_a_torrent_worth_downloading_directly_stays_with_the_player(plus):
    chunks = FakeChunks()

    def torrent(probe, **kw):
        assert probe(0.0, 2 * GiB, 1, 0) == "keep"
        return "C:/games/from-torrent"

    p = pipeline(torrent, chunks)
    assert p.server_or_torrent(ARGS, MAGNET, True, "d", "1", "G") == (None, "C:/games/from-torrent", False)
    assert chunks.downloads == []
    assert p.context.routes == ["measuring", "torrent"]  # the player sees what is really happening


def test_a_slow_big_torrent_is_handed_to_the_server(plus):
    chunks = FakeChunks()

    def torrent(probe, **kw):
        raise SwitchToServer("el torrent no conviene bajarlo directo")

    p = pipeline(torrent, chunks)
    assert p.server_or_torrent(ARGS, MAGNET, True, "d", "1", "G") == ("C:/games/from-server", None, False)
    assert chunks.downloads == [MAGNET]
    assert p.context.routes == ["measuring", "accelerated"]


def test_without_plus_nothing_is_decided_here(monkeypatch):
    monkeypatch.delenv("GAMEACCESS_CHUNK_SESSION", raising=False)
    p = pipeline(lambda **kw: pytest.fail("the caller runs the plain torrent"), FakeChunks(where="viking"))
    assert p.server_or_torrent(ARGS, MAGNET, True, "d", "1", "G") == (None, None, False)


def test_the_route_is_reported_to_the_server(plus):
    from game_download_manager.chunked import ChunkSession
    from game_download_manager.client_events import DownloadReporter
    import time
    sent = []
    chunks = FakeChunks()

    def torrent(probe, **kw):
        assert probe(0.0, 2 * GiB, 1, 0) == "keep"
        return "C:/games/from-torrent"

    p = pipeline(torrent, chunks)
    p.context.reporter = DownloadReporter(ChunkSession("https://api", "t", "i"), "10", "Noita",
                                          post=lambda url, json, headers, timeout: sent.append((url, json["event"], json["detail"])))
    p.server_or_torrent(ARGS, MAGNET, True, "d", "10", "Noita")
    for _ in range(50):
        if len(sent) >= 2:
            break
        time.sleep(0.05)
    assert sorted(sent) == sorted([("https://api/downloads/client-events", "measuring", ""),
                                   ("https://api/downloads/client-events", "torrent", "juego de 2.0 GB (menos de 5 GB)")])


def test_a_source_without_seeds_cancels_the_download_instead_of_falling_back_to_the_torrent(plus):
    from game_download_manager.chunked import SourceWithoutSeeds

    class NoSeeds(FakeChunks):
        def download(self, source, *rest):
            raise SourceWithoutSeeds("Esta descarga se canceló: la fuente está casi sin semillas (1 personas compartiéndola).")

    p = pipeline(lambda **kw: pytest.fail("the torrent must not start"), NoSeeds(where="torbox"))
    with pytest.raises(SourceWithoutSeeds):
        p.server_or_torrent(ARGS, MAGNET, True, "d", "1", "G")
