"""Bounded, serialized JSONL logging for GameAccess download bookkeeping."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from provider_download_probe import _exclusive_file_lock

MAX_LOG_BYTES = 1024 * 1024
MAX_LOG_LINE_CHARS = 32 * 1024


def append_download_log(log_root: Path, app_id: int, body: dict[str, Any]) -> None:
    log_root.mkdir(parents=True, exist_ok=True)
    path = log_root / f"app-{app_id}.jsonl"
    entry = json.dumps(body, ensure_ascii=True)
    if len(entry) > MAX_LOG_LINE_CHARS:
        entry = json.dumps(
            {"app_id": app_id, "event": body.get("event"), "truncated": True},
            ensure_ascii=True,
        )
    line = (entry + "\n").encode("utf-8")
    lock_root = log_root.parent.parent / "locks"
    lock_path = lock_root / "download-log-rotation.lock"

    with _exclusive_file_lock(lock_path, timeout_seconds=10.0):
        current_size = path.stat().st_size if path.is_file() else 0
        if current_size + len(line) > MAX_LOG_BYTES:
            archive = path.with_name(f"{path.name}.1")
            archive.unlink(missing_ok=True)
            if path.is_file():
                path.replace(archive)
                if archive.stat().st_size > MAX_LOG_BYTES:
                    archive.unlink()
        with path.open("ab") as handle:
            handle.write(line)
