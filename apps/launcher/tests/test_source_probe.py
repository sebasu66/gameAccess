import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from game_download_manager import source_probe


class Status:
    def __init__(self, seeds, peers, metadata):
        self.num_seeds, self.list_seeds, self.num_peers, self.list_peers, self.has_metadata = seeds, 0, peers, 0, metadata


class FakeLt:
    """Enough of libtorrent for the probe: a torrent that reports more seeds each second."""
    class torrent_flags:
        upload_mode = 4

    class Params:
        def __init__(self):
            self.trackers, self.flags, self.save_path = [], 0, ""

    def __init__(self, timeline):
        self.timeline, self.added = list(timeline), []
        lt = self

        class Handle:
            def status(self):
                return lt.timeline.pop(0) if len(lt.timeline) > 1 else lt.timeline[0]

        class Session:
            def __init__(self, settings):
                self.torrents = []

            def add_dht_node(self, node):
                pass

            def add_torrent(self, params):
                lt.added.append(params)
                handle = Handle()
                self.torrents.append(handle)
                return handle

            def get_torrents(self):
                return self.torrents

            def remove_torrent(self, handle):
                self.torrents.remove(handle)

        self.session = Session

    def parse_magnet_uri(self, uri):
        return FakeLt.Params()


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, seconds):
        self.t += seconds


def test_a_torrent_is_checked_without_downloading_and_reports_its_seeds():
    lt, clock = FakeLt([Status(0, 0, False), Status(3, 5, True), Status(9, 14, True)]), Clock()
    result = source_probe.probe_torrent("magnet:?xt=urn:btih:abc", timeout=25, lt=lt, clock=clock, sleep=clock.sleep)
    assert result == {"kind": "torrent", "reachable": True, "seeds": 9, "peers": 14, "metadata": True}
    assert lt.added[0].flags & FakeLt.torrent_flags.upload_mode
    assert clock.t < 25  # stopped early: enough seeds


def test_a_dead_torrent_is_not_reachable():
    lt, clock = FakeLt([Status(0, 0, False)]), Clock()
    result = source_probe.probe_torrent("magnet:?xt=urn:btih:dead", timeout=5, lt=lt, clock=clock, sleep=clock.sleep)
    assert result["reachable"] is False and result["seeds"] == 0


def test_sources_are_told_apart():
    assert source_probe.is_torrent("magnet:?xt=urn:btih:abc")
    assert source_probe.is_torrent("https://example.com/game.torrent?x=1")
    assert not source_probe.is_torrent("https://example.com/game.zip")
