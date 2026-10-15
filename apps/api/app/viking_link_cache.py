"""Memory cache for ViKiNG direct links.

A signed ViKiNG link is public and lives 48 hours (measured), and asking twice returns the same one. So a link is
resolved once and then shared by every player; a burst of players asking for the same piece costs one resolution.
"""
from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable

LINK_CACHE_SECONDS = 6 * 3600  # far below the 48 h the links really live
MAX_PARALLEL_RESOLVES = 8  # ViKiNG is asked a few things at a time, however many players ask


class LinkCache:
    def __init__(self, ttl: float = LINK_CACHE_SECONDS, max_parallel: int = MAX_PARALLEL_RESOLVES):
        self.ttl = ttl
        self.max_parallel = max_parallel
        self._links: dict[str, tuple[str, float]] = {}
        self._pending: dict[str, "asyncio.Future[str]"] = {}
        self._gate: tuple[asyncio.AbstractEventLoop, asyncio.Semaphore] | None = None
        self.resolutions = 0  # how many times ViKiNG was really asked (used by tests and logs)

    def clear(self) -> None:
        self._links.clear()
        self._pending.clear()
        self._gate = None
        self.resolutions = 0

    def _semaphore(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        if self._gate is None or self._gate[0] is not loop:
            self._gate = (loop, asyncio.Semaphore(self.max_parallel))
        return self._gate[1]

    def peek(self, key: str) -> str | None:
        hit = self._links.get(key)
        if hit is None:
            return None
        if hit[1] <= time.monotonic():
            self._links.pop(key, None)
            return None
        return hit[0]

    async def get(self, key: str, resolver: Callable[[str], Awaitable[str]]) -> str:
        cached = self.peek(key)
        if cached is not None:
            return cached
        pending = self._pending.get(key)
        if pending is not None:  # somebody is already asking ViKiNG for this one: wait for that answer
            return await asyncio.shield(pending)
        future: "asyncio.Future[str]" = asyncio.get_running_loop().create_future()
        self._pending[key] = future
        try:
            async with self._semaphore():
                self.resolutions += 1
                url = await resolver(key)
            self._links[key] = (url, time.monotonic() + self.ttl)
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
