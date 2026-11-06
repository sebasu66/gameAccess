"""Phone alerts for the server's own problems, through ntfy (https://ntfy.sh).

The server POSTs a JSON message to ntfy and it shows up in the ntfy app on the phone subscribed to the topic.
Topics on ntfy.sh are public, so GAMEACCESS_NTFY_TOPIC must be a long name nobody can guess; without it alerts are
only logged. The same alert is sent at most once per `cooldown` seconds. Never put keys, links or player data in an
alert: anyone who knows the topic can read it.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Callable

import httpx

logger = logging.getLogger("gameaccess.notify")

NTFY_SERVER = "https://ntfy.sh/"
_last_sent: dict[str, float] = {}
_lock = threading.Lock()


def notify(key: str, title: str, message: str, priority: int = 4, cooldown: float = 3600,
           post: Callable[..., httpx.Response] = httpx.post, clock: Callable[[], float] = time.monotonic) -> bool:
    """Send one alert; returns whether it went out. `key` groups repeats of the same alert for the cooldown."""
    logger.warning("alert key=%s title=%s message=%s", key, title, message)
    topic = os.getenv("GAMEACCESS_NTFY_TOPIC", "").strip()
    if not topic:
        return False
    now = clock()
    with _lock:
        last = _last_sent.get(key)
        if last is not None and now - last < cooldown:
            return False
        _last_sent[key] = now
    try:
        response = post(NTFY_SERVER, json={"topic": topic, "title": title, "message": message, "priority": priority,
                                           "tags": ["warning"]}, timeout=10)
        return response.status_code < 300
    except httpx.HTTPError as exc:
        logger.warning("alert_not_sent key=%s error=%s", key, type(exc).__name__)
        return False
