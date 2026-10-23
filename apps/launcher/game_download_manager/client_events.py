"""Tells the server how a PLUS player's download went, for the administrator's story of that download.

Route chosen (torrent direct or the server), started, finished, failed or cancelled. It never slows or breaks the
download: each report is one short call in the background, and the last one waits a few seconds at most.
"""
from __future__ import annotations

import threading
import time
from typing import Any

import requests

from game_download_manager.chunked import ChunkSession

TIMEOUT_SECONDS = 5.0


class DownloadReporter:
    def __init__(self, session: ChunkSession, app_id: str, item_name: str, post: Any = None):
        self.session = session
        self.app_id = int(app_id) if str(app_id).isdigit() else 0
        self.item_name = item_name
        self.job_id = ""          # the server's job, once the download goes through the server
        self.started = time.monotonic()
        self._post = post or requests.post

    @staticmethod
    def from_session(session: ChunkSession | None, app_id: str, item_name: str) -> "DownloadReporter | None":
        return DownloadReporter(session, app_id, item_name) if session else None

    def send(self, event: str, detail: str = "", size: int = 0, wait: bool = False) -> None:
        body = {"event": event, "app_id": self.app_id, "item_name": self.item_name[:300], "job_id": self.job_id,
                "detail": str(detail or "")[:300], "bytes": max(0, int(size or 0)),
                "seconds": round(time.monotonic() - self.started, 1) if event in ("finished", "failed", "cancelled") else 0}
        headers = {"Authorization": f"Bearer {self.session.token}", "X-GameAccess-Installation": self.session.installation}

        def call() -> None:
            try:
                self._post(f"{self.session.api}/downloads/client-events", json=body, headers=headers, timeout=TIMEOUT_SECONDS)
            except Exception:  # noqa: BLE001 - a report never affects the download
                pass

        worker = threading.Thread(target=call, daemon=True)
        worker.start()
        if wait:
            worker.join(TIMEOUT_SECONDS + 1)
