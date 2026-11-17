"""The race between torrents of the same game (Seba, 2026-11-11): several start downloading at once, and after a minute or
two the one that brought down the most goes on while the others are removed. Nothing the winner got is lost: it keeps
running in the same session and is only moved into the game's folder.

Which torrents race, and for how long, is the server's answer (`POST /downloads/race-plan`): it checks the seeds of
every candidate in parallel and says, for the player's plan, how many race. Without that answer there is no race and
the download starts with the first source, as before. The rule that picks the winner lives here, apart from libtorrent,
so it can be tested on its own.
"""
from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlparse

_BTIH = re.compile(r"urn:btih:([0-9a-zA-Z]+)", re.IGNORECASE)


def magnet_info_hash(source: str) -> str | None:
    """The torrent's info-hash (40 lowercase hex characters) in a magnet link, or None."""
    if not source.lower().startswith("magnet:?"):
        return None
    for value in parse_qs(urlparse(source).query).get("xt", []):
        found = _BTIH.search(value)
        if not found:
            continue
        code = found.group(1)
        if len(code) == 40 and re.fullmatch(r"[0-9a-fA-F]{40}", code):
            return code.lower()
        if len(code) == 32:
            try:
                return binascii.hexlify(base64.b32decode(code.upper())).decode()
            except (binascii.Error, ValueError):
                return None
    return None


@dataclass
class Racer:
    """One torrent in the race, as the app sends it."""
    source: str
    title: str = ""
    provider: str = ""


@dataclass
class RacePlan:
    """What the server allowed: the torrents to race (best first) and how long the race may last."""
    racers: list[Racer] = field(default_factory=list)
    decide_after: float = 60.0     # seconds before a winner may be named
    give_up_after: float = 120.0   # the leader wins at this point whatever the gap
    lead: float = 1.25             # the leader must have this many times what the second has
    metadata_timeout: float = 45.0 # a torrent that found nothing by then drops out

    @classmethod
    def from_dict(cls, data: dict | None) -> "RacePlan | None":
        """The plan the app wrote for this download, or None when there is nothing to race (fewer than two)."""
        if not isinstance(data, dict):
            return None
        racers = [Racer(str(item.get("source") or "").strip(), str(item.get("title") or ""), str(item.get("provider") or ""))
                  for item in data.get("racers") or [] if isinstance(item, dict)]
        racers = [racer for racer in racers if racer.source]
        if len(racers) < 2:
            return None
        number = lambda key, fallback: float(data.get(key)) if isinstance(data.get(key), (int, float)) and data.get(key) > 0 else fallback
        plan = cls(racers, number("decideAfter", 60.0), number("giveUpAfter", 120.0), number("lead", 1.25), number("metadataTimeout", 45.0))
        plan.give_up_after = max(plan.give_up_after, plan.decide_after)
        return plan


@dataclass
class Lane:
    """How one racer is doing: bytes it has, of how many, whether it found the torrent's data and whether it is done."""
    done: int = 0
    total: int = 0
    seeds: int = 0
    speed: int = 0
    metadata: bool = False
    finished: bool = False
    dropped: bool = False


def race_winner(plan: RacePlan, elapsed: float, lanes: list[Lane]) -> int | None:
    """The index of the racer that goes on, or None while the race goes on.

    A racer that finished wins at once. A racer that found nothing by the metadata timeout drops out; when only one is
    left it wins. From `decide_after` the one with the most bytes wins if it leads the second by `lead` times; at
    `give_up_after` the one with the most bytes wins anyway (ties: more seeds, then the server's order)."""
    for index, lane in enumerate(lanes):
        if lane.finished and not lane.dropped:
            return index
    alive = [index for index, lane in enumerate(lanes) if not lane.dropped]
    if not alive:
        return None
    if len(alive) == 1 and (lanes[alive[0]].metadata or elapsed >= plan.metadata_timeout):
        return alive[0]
    if elapsed < plan.decide_after:
        return None
    ranked = sorted(alive, key=lambda index: (-lanes[index].done, -lanes[index].seeds, index))
    leader = ranked[0]
    if lanes[leader].done <= 0:
        # Nothing came down from anyone yet: wait until the end, then the best seeded goes on.
        return leader if elapsed >= plan.give_up_after else None
    second = lanes[ranked[1]].done if len(ranked) > 1 else 0
    if elapsed >= plan.give_up_after or lanes[leader].done >= second * plan.lead:
        return leader
    return None
