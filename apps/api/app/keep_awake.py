"""Keeps a free Render web service awake with one request of its own, instead of one heartbeat per player.

Render spins a free web service down after 15 minutes without inbound traffic, and only inbound requests count
(work done inside the server does not; neither does a network ping, which never reaches the app). So the server
asks its own public address (RENDER_EXTERNAL_URL, which Render sets) for /ping, an empty answer, every 10 minutes:
the request goes out and comes back in through Render, which keeps the service up whatever the number of players.
Off outside Render, or with GAMEACCESS_KEEP_AWAKE=0.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Callable

import httpx

logger = logging.getLogger("gameaccess.keep_awake")

INTERVAL_SECONDS = 600  # under Render's 15 minutes (GAMEACCESS_KEEP_AWAKE_SECONDS)

_stop = threading.Event()
_thread: threading.Thread | None = None


def ping_once(url: str, get: Callable[..., httpx.Response] = httpx.get) -> bool:
    try:
        return get(f"{url.rstrip('/')}/ping", timeout=30).status_code < 500
    except httpx.HTTPError as exc:
        logger.warning("keep_awake_ping_failed error=%s", type(exc).__name__)
        return False


def run(url: str, interval: float, stop: threading.Event, get: Callable[..., httpx.Response] = httpx.get) -> None:
    while not stop.wait(interval):
        ping_once(url, get)


def start() -> bool:
    """Start the background ping when running on Render; returns whether it started."""
    global _thread
    url = os.getenv("RENDER_EXTERNAL_URL", "").strip()
    if not url or os.getenv("GAMEACCESS_KEEP_AWAKE", "1").strip() == "0" or (_thread and _thread.is_alive()):
        return False
    interval = max(60.0, float(os.getenv("GAMEACCESS_KEEP_AWAKE_SECONDS") or INTERVAL_SECONDS))
    _stop.clear()
    _thread = threading.Thread(target=run, args=(url, interval, _stop), name="keep-awake", daemon=True)
    _thread.start()
    logger.info("keep_awake_started every=%ss", int(interval))
    return True


def stop() -> None:
    _stop.set()
