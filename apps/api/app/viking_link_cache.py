"""Memory cache for ViKiNG direct links: use first, ask for a new one only when it no longer works.

A signed ViKiNG link is public and lives 48 hours (measured), and asking twice returns the same one. So a link is
resolved once and shared by every player. It is never thrown away for being old: before handing it out the server
tries it (at most once every VERIFY_EVERY_SECONDS per link); if ViKiNG refuses it, a new one is asked for.
"""
from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable
from urllib.parse import parse_qs, urlsplit

import httpx

VERIFY_EVERY_SECONDS = 300.0  # a link that worked a moment ago is not tried again for every player
EXPIRY_MARGIN_SECONDS = 120.0  # a link about to expire (its own signed date says so) is replaced
MAX_PARALLEL_RESOLVES = 8  # ViKiNG is asked a few things at a time, however many players ask
DEAD_STATUSES = (400, 401, 403, 404, 410)


def signed_expiry(url: str) -> float | None:
    """The `expires` Unix time ViKiNG signs into a link, if any."""
    try:
        return float(parse_qs(urlsplit(url).query)["expires"][0])
    except (KeyError, ValueError, IndexError):
        return None


async def probe_direct_link(url: str) -> bool:
    """Whether ViKiNG still serves this link (asks for one byte). Only a clear refusal counts as dead:
    a timeout or network error says nothing about the link, so it is handed out and the player retries."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=False) as client:
            response = await client.get(url, headers={"Range": "bytes=0-0"})
    except httpx.HTTPError:
        return True
    return response.status_code not in DEAD_STATUSES


class _Entry:
    __slots__ = ("url", "expires_at", "verified_at")

    def __init__(self, url: str):
        self.url = url
        self.expires_at = signed_expiry(url)
        self.verified_at = time.monotonic()

    def usable(self) -> bool:
        return self.expires_at is None or self.expires_at - EXPIRY_MARGIN_SECONDS > time.time()


class LinkCache:
    def __init__(self, verify_every: float = VERIFY_EVERY_SECONDS, max_parallel: int = MAX_PARALLEL_RESOLVES):
        self.verify_every = verify_every
        self.max_parallel = max_parallel
        self._links: dict[str, _Entry] = {}
        self._pending: dict[str, "asyncio.Future[str]"] = {}
        self._gate: tuple[asyncio.AbstractEventLoop, asyncio.Semaphore] | None = None
        self.resolutions = 0  # how many times ViKiNG was really asked for a link
        self.probes = 0  # how many times a cached link was tried before being handed out

    def clear(self) -> None:
        self._links.clear()
        self._pending.clear()
        self._gate = None
        self.resolutions = self.probes = 0

    def _semaphore(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        if self._gate is None or self._gate[0] is not loop:
            self._gate = (loop, asyncio.Semaphore(self.max_parallel))
        return self._gate[1]

    def forget(self, key: str) -> None:
        self._links.pop(key, None)

    async def get(
        self, key: str, resolver: Callable[[str], Awaitable[str]],
        verifier: Callable[[str], Awaitable[bool]] | None = None, refresh: bool = False,
    ) -> str:
        entry = self._links.get(key)
        if entry is not None and (refresh or not entry.usable()):
            self._links.pop(key, None)
            entry = None
        if entry is not None and (verifier is None or time.monotonic() - entry.verified_at < self.verify_every):
            return entry.url
        pending = self._pending.get(key)
        if pending is not None:  # somebody is already checking/asking for this one: wait for that answer
            return await asyncio.shield(pending)
        future: "asyncio.Future[str]" = asyncio.get_running_loop().create_future()
        self._pending[key] = future
        try:
            async with self._semaphore():
                if entry is not None and verifier is not None:
                    self.probes += 1
                    if await verifier(entry.url):
                        entry.verified_at = time.monotonic()
                        future.set_result(entry.url)
                        return entry.url
                    self._links.pop(key, None)  # ViKiNG refused it: a new one is needed
                self.resolutions += 1
                url = await resolver(key)
            self._links[key] = _Entry(url)
            future.set_result(url)
            return url
        except BaseException as exc:
            if not future.done():
                future.set_exception(exc)
                future.exception()  # nobody else waiting is fine; avoid "never retrieved" noise
            raise
        finally:
            self._pending.pop(key, None)


link_cache = LinkCache()
