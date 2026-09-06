from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.request
from pathlib import Path

from transfer_core import TransferOrchestrator

SINTEL_TORRENT_URL = "https://webtorrent.io/torrents/sintel.torrent"


def status(event: dict) -> None:
    safe = {
        "stage": event.get("stage"),
        "message": event.get("message"),
        "progress": event.get("progress"),
    }
    print(json.dumps(safe, ensure_ascii=False), flush=True)


def main() -> int:
    token = os.environ.get("REAL_DEBRID_TOKEN", "").strip()
    if not token:
        print(json.dumps({
            "status": "blocked",
            "reason": "REAL_DEBRID_TOKEN is not configured",
            "source": SINTEL_TORRENT_URL,
            "payload_downloaded_locally": False,
        }, indent=2))
        return 2

    with tempfile.TemporaryDirectory(prefix="gameaccess-sintel-") as tmp:
        torrent_path = Path(tmp) / "sintel.torrent"
        print(json.dumps({"stage": "sample", "message": "Downloading official Sintel .torrent metadata only"}), flush=True)
        urllib.request.urlretrieve(SINTEL_TORRENT_URL, torrent_path)
        if torrent_path.stat().st_size < 100:
            raise RuntimeError("Downloaded Sintel torrent metadata is unexpectedly small")

        orchestrator = TransferOrchestrator(
            real_debrid_token=token,
            destination="ViKiNG FiLE (anonymous)",
        )
        result = orchestrator.run(
            str(torrent_path),
            selection_mode="largest",
            callback=status,
        )
        print(json.dumps({
            "status": "ok",
            "sample": "Sintel (Creative Commons)",
            "source": SINTEL_TORRENT_URL,
            "payload_downloaded_locally": False,
            "result": result,
        }, indent=2, ensure_ascii=False))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
