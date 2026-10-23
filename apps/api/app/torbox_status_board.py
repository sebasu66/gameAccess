"""One shared view of TorBox's download list (the same list its dashboard shows).

Every running job reads its item from here instead of asking TorBox itself, so the number of TorBox
requests depends on time, not on how many clients or downloads there are: at most one request per
`interval` seconds for torrents and one for web downloads, however many jobs are waiting. When nobody
asks, nothing is requested (the board refreshes lazily, there is no background task to stop).

A failed refresh keeps the last good list for `max_stale` seconds, so a TorBox hiccup does not fail
every download that is waiting on it.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

# download_state words TorBox uses, grouped for the summary.
_ACTIVE = {"downloading", "metadl", "checking", "checkingresumedata", "uploading"}
_STALLED = {"stalled", "stalleddl", "stalled (no seeds)"}
_DONE = {"completed", "complete", "finished", "cached"}


@dataclass
class _Snapshot:
    items: dict[int, dict[str, Any]] = field(default_factory=dict)
    at: float | None = None          # last successful refresh
    last_attempt: float = 0.0
    error: BaseException | None = None
    failures: int = 0


def _state_of(item: dict[str, Any]) -> str:
    return str(item.get("download_state") or item.get("status") or "").strip().lower()


class TorboxStatusBoard:
    def __init__(
        self,
        fetch: Callable[[str], Awaitable[list[dict[str, Any]]]],
        *,
        interval: float = 8.0,
        max_stale: float = 180.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._fetch = fetch
        self.interval = max(0.0, interval)
        self.max_stale = max(0.0, max_stale)
        self._clock = clock
        self._snapshots: dict[str, _Snapshot] = {}
        self._inflight: dict[str, asyncio.Future] = {}
        self.requests = 0  # how many times TorBox was really asked (for tests and the admin view)

    async def _refresh(self, kind: str) -> None:
        pending = self._inflight.get(kind)
        loop = asyncio.get_running_loop()
        if pending is not None and not pending.done() and pending.get_loop() is loop:
            await asyncio.shield(pending)  # somebody is already asking: share that answer
            return
        task = asyncio.ensure_future(self._do_refresh(kind))
        self._inflight[kind] = task
        await asyncio.shield(task)

    async def _do_refresh(self, kind: str) -> None:
        snapshot = self._snapshots.setdefault(kind, _Snapshot())
        snapshot.last_attempt = self._clock()
        self.requests += 1
        try:
            items = await self._fetch(kind)
        except Exception as exc:  # noqa: BLE001 - kept and judged by get()
            snapshot.error = exc
            snapshot.failures += 1
            return
        snapshot.items = {int(item["id"]): item for item in items if isinstance(item, dict) and str(item.get("id", "")).isdigit()}
        snapshot.at, snapshot.error, snapshot.failures = self._clock(), None, 0

    async def get(self, kind: str, item_id: int) -> dict[str, Any] | None:
        """The item as of the last refresh (refreshing first when it is older than `interval`).

        None when TorBox's list does not have it; raises the TorBox error when the list is too old to trust."""
        snapshot = self._snapshots.get(kind)
        if snapshot is None or self._clock() - snapshot.last_attempt >= self.interval:
            await self._refresh(kind)
            snapshot = self._snapshots[kind]
        if snapshot.at is None or (snapshot.error is not None and self._clock() - snapshot.at > self.max_stale):
            if snapshot.error is not None:
                raise snapshot.error
            return None
        return snapshot.items.get(item_id)

    def summary(self) -> dict[str, Any]:
        """The general state of TorBox in a few numbers: what a player is told about the queue."""
        counts = {"downloading": 0, "queued": 0, "stalled": 0, "ready": 0}
        newest: float | None = None
        for snapshot in self._snapshots.values():
            if snapshot.at is not None:
                newest = snapshot.at if newest is None else max(newest, snapshot.at)
            for item in snapshot.items.values():
                state = _state_of(item)
                if item.get("download_finished") is True or state in _DONE:
                    counts["ready"] += 1
                elif state in _STALLED:
                    counts["stalled"] += 1
                elif state == "queued":
                    counts["queued"] += 1
                elif state in _ACTIVE:
                    counts["downloading"] += 1
        return {**counts, "age_seconds": None if newest is None else round(self._clock() - newest, 1)}
