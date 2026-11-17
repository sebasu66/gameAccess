"""Which torrents of a game race at the start of a download, and for how long (Seba, 2026-11-11).

The app sends the candidate torrents of the game (best first by its own ranking) as info-hashes; the server asks
public trackers in parallel how many seeds each has (UDP scrape, BEP 15) and answers with the ones that race and the
race's rules for the player's plan. The launcher races them (apps/launcher/game_download_manager/source_race.py);
without this answer there is no race and the download starts with the first source.

What each plan gets is `RACE_TIERS`, or the `GAMEACCESS_RACE_TIERS` environment variable (the same JSON shape), so
moving the race between free and PLUS is a change of settings, not of code. A plan with `racers` below 2 does not race.
"""
from __future__ import annotations

import json
import os
import random
import socket
import struct
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import Session

from .access_overrides import CourtesySession, courtesy_access_tier
from .access_service import _activation_for_request
from .api_dependencies import get_session

router = APIRouter(tags=["downloads"])

RACE_TIERS: dict[str, dict] = {
    # Free players race too (the download starts as early as possible for everyone), with fewer torrents.
    "base": {"racers": 2, "decideAfter": 60, "giveUpAfter": 120, "lead": 1.25, "metadataTimeout": 45},
    "plus": {"racers": 3, "decideAfter": 60, "giveUpAfter": 120, "lead": 1.25, "metadataTimeout": 45},
}
SCRAPE_TRACKERS = (
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
)
SCRAPE_TIMEOUT_SECONDS = 3.0
MAX_CANDIDATES = 12
_PROTOCOL_ID = 0x41727101980


def race_tiers() -> dict[str, dict]:
    raw = os.getenv("GAMEACCESS_RACE_TIERS", "").strip()
    if raw:
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                return loaded
        except ValueError:
            pass
    return RACE_TIERS


def scrape_tracker(tracker: str, hashes: list[str], timeout: float = SCRAPE_TIMEOUT_SECONDS) -> dict[str, int]:
    """Seeds per info-hash from one UDP tracker (BEP 15); {} when it does not answer."""
    address = urlparse(tracker)
    if address.scheme != "udp" or not address.hostname or not address.port or not hashes:
        return {}
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(timeout)
            target = (socket.gethostbyname(address.hostname), address.port)
            transaction = random.getrandbits(32)
            sock.sendto(struct.pack(">QII", _PROTOCOL_ID, 0, transaction), target)
            reply = sock.recv(2048)
            action, answered, connection = struct.unpack(">IIQ", reply[:16])
            if action != 0 or answered != transaction:
                return {}
            transaction = random.getrandbits(32)
            sock.sendto(struct.pack(">QII", connection, 2, transaction) + b"".join(bytes.fromhex(h) for h in hashes), target)
            reply = sock.recv(8 + 12 * len(hashes))
            action, answered = struct.unpack(">II", reply[:8])
            if action != 2 or answered != transaction:
                return {}
            seeds = {}
            for index, info_hash in enumerate(hashes):
                chunk = reply[8 + 12 * index: 20 + 12 * index]
                if len(chunk) == 12:
                    seeds[info_hash] = struct.unpack(">III", chunk)[0]
            return seeds
    except (OSError, struct.error, ValueError):
        return {}


def scrape_seeds(hashes: list[str], scrape=scrape_tracker) -> dict[str, int]:
    """The most seeds any tracker reports for each hash, asking every tracker at once."""
    if not hashes:
        return {}
    best: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=len(SCRAPE_TRACKERS)) as pool:
        for answer in pool.map(lambda tracker: scrape(tracker, hashes), SCRAPE_TRACKERS):
            for info_hash, seeds in answer.items():
                best[info_hash] = max(best.get(info_hash, 0), int(seeds))
    return best


class RaceCandidate(BaseModel):
    index: int = Field(ge=0, le=100)
    hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{40}$")


class RacePlanRequest(BaseModel):
    candidates: list[RaceCandidate] = Field(default_factory=list, max_length=40)


def plan_race(tier: str, candidates: list[RaceCandidate], scrape=scrape_tracker) -> dict:
    """The racers (candidate indices, most seeds first) and the rules; no `racers` when this plan does not race."""
    rules = race_tiers().get(tier) or race_tiers().get("base") or {}
    count = int(rules.get("racers") or 0)
    candidates = candidates[:MAX_CANDIDATES]
    if count < 2 or len(candidates) < 2:
        return {"racers": []}
    seeds = scrape_seeds(sorted({c.hash for c in candidates if c.hash}), scrape)
    # Known seeds first (most first), then those no tracker knows, in the app's order; a torrent nobody seeds is last.
    def rank(item):
        position, candidate = item
        known = seeds.get(candidate.hash or "")
        return (0 if known else 1 if known is None else 2, -(known or 0), position)
    ranked = [candidate for _, candidate in sorted(enumerate(candidates), key=rank)]
    racers = [{"index": c.index, "seeds": seeds.get(c.hash or "")} for c in ranked[:count]]
    return {"racers": racers, **{key: rules[key] for key in ("decideAfter", "giveUpAfter", "lead", "metadataTimeout") if key in rules}}


@router.post("/downloads/race-plan")
def race_plan(req: RacePlanRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    row = _activation_for_request(request, session)
    if row is None:
        raise HTTPException(401, "activation required")
    tier = courtesy_access_tier(row) if isinstance(row, CourtesySession) else row.access_tier
    return plan_race(tier or "base", req.candidates)
