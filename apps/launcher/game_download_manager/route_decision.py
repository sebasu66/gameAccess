"""Whether a PLUS player downloads a torrent itself or asks the server for it (TorBox -> ViKiNG pieces).

The player starts the torrent with its own client and measures it for a few seconds. A small game, a
torrent with many seeds or one that already downloads fast stays with the player: the server would add
nothing. A big game that crawls is stopped and handed to the server, which streams it back in pieces.
"""
from __future__ import annotations

from game_download_manager.ui_text import ui

GiB = 1024 ** 3
MiB = 1024 ** 2
BIG_DOWNLOAD_BYTES = 5 * GiB   # below this the player always downloads the torrent itself
GOOD_SEEDS = 20                # this many seeds is a healthy torrent
GOOD_SPEED_BPS = 5 * MiB       # or this speed, measured by the player itself
WARMUP_SECONDS = 5.0           # a torrent needs a moment to find peers before its speed means anything
PROBE_SECONDS = 20.0           # measuring ends here


class SwitchToServer(Exception):
    """The torrent is not worth downloading directly; the caller asks the server for it."""


class TorrentProbe:
    """Fed with what the torrent reports while it starts; answers "keep", "server" or None (still measuring)."""

    def __init__(self) -> None:
        self.seeds = 0
        self.speed = 0
        self.reason = ""  # Spanish, for logs and the server's report
        self.why = ""     # the same for the player, as translation keys
        self._base: tuple[float, int] | None = None

    def decide(self, elapsed: float, total: int, seeds: int, done: int) -> str | None:
        self.seeds = max(self.seeds, seeds)
        if 0 < total < BIG_DOWNLOAD_BYTES:
            self.reason = f"juego de {total / GiB:.1f} GB (menos de {BIG_DOWNLOAD_BYTES // GiB} GB)"
            self.why = ui("dlWhySmall", gb=round(total / GiB, 1), limit=BIG_DOWNLOAD_BYTES // GiB)
            return "keep"
        if self.seeds >= GOOD_SEEDS:
            self.reason = f"{self.seeds} fuentes compartiendo"
            self.why = ui("dlWhySeeds", seeds=self.seeds)
            return "keep"
        if elapsed < WARMUP_SECONDS:
            return None
        if self._base is None:
            self._base = (elapsed, done)
            return None
        if elapsed < PROBE_SECONDS:
            return None
        since, base_done = self._base
        self.speed = int(max(done - base_done, 0) / max(elapsed - since, 0.001))
        if self.speed >= GOOD_SPEED_BPS:
            self.reason = f"baja a {self.speed / MiB:.1f} MB/s"
            self.why = ui("dlWhySpeed", mbps=round(self.speed / MiB, 1))
            return "keep"
        self.reason = f"juego de {total / GiB:.1f} GB, {self.seeds} fuentes y {self.speed / MiB:.1f} MB/s"
        self.why = ui("dlWhySlow", gb=round(total / GiB, 1), seeds=self.seeds, mbps=round(self.speed / MiB, 1))
        return "server"
