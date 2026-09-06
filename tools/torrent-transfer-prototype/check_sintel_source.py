from __future__ import annotations

import hashlib
import json
import tempfile
import urllib.request
from pathlib import Path

SINTEL_TORRENT_URL = "https://webtorrent.io/torrents/sintel.torrent"


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="gameaccess-sintel-source-") as tmp:
        path = Path(tmp) / "sintel.torrent"
        with urllib.request.urlopen(SINTEL_TORRENT_URL, timeout=30) as response:
            payload = response.read()
        path.write_bytes(payload)

        valid = (
            len(payload) >= 100
            and payload.startswith(b"d")
            and b"4:info" in payload
            and (b"8:announce" in payload or b"13:announce-list" in payload)
        )
        report = {
            "status": "ok" if valid else "invalid",
            "source": SINTEL_TORRENT_URL,
            "metadata_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "starts_with_bencoded_dictionary": payload.startswith(b"d"),
            "contains_info_dictionary": b"4:info" in payload,
            "contains_tracker_metadata": b"8:announce" in payload or b"13:announce-list" in payload,
            "torrent_payload_downloaded": False,
        }
        print(json.dumps(report, indent=2))
        return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
