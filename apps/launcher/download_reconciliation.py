"""Filesystem-only cache hygiene helpers for GameAccess.

This module deliberately owns only local download-staging cleanup/recovery.
It does not launch Steam, switch accounts, or decide UI behavior.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from digital_storage import DigitalGameStorage

RUNTIME_ROOT = Path(os.environ.get("GAMEACCESS_DATA_DIR") or (Path(__file__).resolve().parent / ".gameaccess"))
DOWNLOAD_ROOT = RUNTIME_ROOT / "downloads"
STATUS_ROOT = DOWNLOAD_ROOT / "status"
LOG_ROOT = DOWNLOAD_ROOT / "logs"
LOCK_ROOT = RUNTIME_ROOT / "locks"
MEDIA_CACHE_ROOT = RUNTIME_ROOT / "media-cache"
TOOLS_ROOT = RUNTIME_ROOT / "tools"

DIGITAL_PROTECTED_ROOTS = (DigitalGameStorage().root, DigitalGameStorage().registry)


def _digital_protected(path: Path) -> bool:
    candidate = path.resolve()
    return any(candidate.is_relative_to(root.resolve()) or root.resolve().is_relative_to(candidate)
               for root in DIGITAL_PROTECTED_ROOTS)


STALE_TEMP_SECONDS = 24 * 60 * 60
STALE_LOCK_SECONDS = 6 * 60 * 60
MEDIA_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
MEDIA_CACHE_MAX_BYTES = 128 * 1024 * 1024
DOWNLOAD_LOG_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
DOWNLOAD_LOG_MAX_BYTES = 64 * 1024 * 1024


def _directory_bytes(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for item in path.rglob("*"):
        if item.is_symlink() or not item.is_file():
            continue
        try:
            total += item.stat().st_size
        except OSError:
            pass
    return total


def _regular_files(path: Path) -> list[Path]:
    if not path.exists() or path.is_symlink():
        return []
    return [item for item in path.rglob("*") if not item.is_symlink() and item.is_file()]


def _log(app_id: int, event: str, **details: Any) -> None:
    body = {
        "at": datetime.now(timezone.utc).isoformat(),
        "app_id": app_id,
        "event": event,
        **details,
    }
    logging.getLogger("gameaccess.download_hygiene").info("%s", json.dumps(body, ensure_ascii=True))


def _age_seconds(path: Path) -> float:
    try:
        return max(0.0, datetime.now(timezone.utc).timestamp() - path.stat().st_mtime)
    except OSError:
        return 0.0


def _remove_regular_file(path: Path) -> bool:
    if _digital_protected(path) or path.is_symlink() or not path.is_file():
        return False
    try:
        path.unlink()
        return True
    except OSError:
        return False


def _active_status_app_ids() -> set[int]:
    active: set[int] = set()
    if not STATUS_ROOT.is_dir() or STATUS_ROOT.is_symlink():
        return active
    for path in STATUS_ROOT.glob("app-*.json"):
        raw = path.stem.removeprefix("app-")
        if not raw.isdigit():
            continue
        status = _read_status(int(raw))
        if status and status.get("state") in {"requested", "preparing", "downloading", "paused", "cancelling"}:
            active.add(int(raw))
    return active


def _prune_stale_temp_files() -> int:
    removed = 0
    for root in (DOWNLOAD_ROOT, STATUS_ROOT):
        if not root.is_dir() or root.is_symlink():
            continue
        for path in root.rglob("*.tmp"):
            if _age_seconds(path) > STALE_TEMP_SECONDS and _remove_regular_file(path):
                removed += 1
    return removed


def _prune_stale_locks() -> int:
    removed = 0
    if not LOCK_ROOT.is_dir() or LOCK_ROOT.is_symlink():
        return removed
    for path in LOCK_ROOT.rglob("*.lock"):
        if _age_seconds(path) > STALE_LOCK_SECONDS and _remove_regular_file(path):
            removed += 1
    return removed


def _prune_manifest_probes(active_app_ids: set[int]) -> tuple[int, int]:
    removed_dirs = 0
    removed_bytes = 0
    if not DOWNLOAD_ROOT.is_dir() or DOWNLOAD_ROOT.is_symlink():
        return removed_dirs, removed_bytes
    root = DOWNLOAD_ROOT.resolve()
    for provider_dir in DOWNLOAD_ROOT.iterdir():
        if _digital_protected(provider_dir) or provider_dir.is_symlink() or not provider_dir.is_dir() or provider_dir.name in {"logs", "status"}:
            continue
        for path in provider_dir.iterdir():
            if _digital_protected(path) or path.is_symlink() or not path.is_dir() or not path.name.endswith("-manifest-only"):
                continue
            raw = path.name.removesuffix("-manifest-only")
            if not raw.isdigit() or int(raw) in active_app_ids:
                continue
            try:
                path.resolve().relative_to(root)
            except (OSError, ValueError):
                continue
            bytes_present = _directory_bytes(path)
            try:
                shutil.rmtree(path)
            except OSError:
                continue
            removed_dirs += 1
            removed_bytes += bytes_present
        try:
            if not any(provider_dir.iterdir()):
                provider_dir.rmdir()
        except OSError:
            pass
    return removed_dirs, removed_bytes


def _bounded_file_prune(
    root: Path,
    *,
    max_age_seconds: int,
    max_total_bytes: int,
    protected_names: set[str] | None = None,
) -> tuple[int, int]:
    if not root.is_dir() or root.is_symlink():
        return 0, 0
    protected_names = protected_names or set()
    files: list[tuple[float, int, Path]] = []
    for path in root.iterdir():
        if path.name in protected_names or path.is_symlink() or not path.is_file():
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        files.append((stat.st_mtime, stat.st_size, path))

    removed = 0
    removed_bytes = 0
    now = datetime.now(timezone.utc).timestamp()
    kept: list[tuple[float, int, Path]] = []
    for modified, size, path in files:
        if now - modified > max_age_seconds and _remove_regular_file(path):
            removed += 1
            removed_bytes += size
        else:
            kept.append((modified, size, path))

    total = sum(size for _modified, size, _path in kept)
    for _modified, size, path in sorted(kept, key=lambda item: item[0]):
        if total <= max_total_bytes:
            break
        if _remove_regular_file(path):
            total -= size
            removed += 1
            removed_bytes += size
    return removed, removed_bytes


def _prune_download_logs(active_app_ids: set[int]) -> tuple[int, int]:
    protected: set[str] = set()
    for app_id in active_app_ids:
        protected.add(f"app-{app_id}.jsonl")
        protected.add(f"app-{app_id}.jsonl.1")
    return _bounded_file_prune(
        LOG_ROOT,
        max_age_seconds=DOWNLOAD_LOG_MAX_AGE_SECONDS,
        max_total_bytes=DOWNLOAD_LOG_MAX_BYTES,
        protected_names=protected,
    )


def _prune_media_cache() -> tuple[int, int]:
    return _bounded_file_prune(
        MEDIA_CACHE_ROOT,
        max_age_seconds=MEDIA_CACHE_MAX_AGE_SECONDS,
        max_total_bytes=MEDIA_CACHE_MAX_BYTES,
    )


def _prune_old_download_tools(active_app_ids: set[int]) -> tuple[int, int]:
    # Steam depot-tool management belongs to the archived branch.
    return 0, 0


def _run_storage_hygiene() -> dict[str, int]:
    active = _active_status_app_ids()
    probes, probe_bytes = _prune_manifest_probes(active)
    download_logs, download_log_bytes = _prune_download_logs(active)
    media_files, media_bytes = _prune_media_cache()
    old_tools, old_tool_bytes = _prune_old_download_tools(active)
    return {
        "stale_temp_files_removed": _prune_stale_temp_files(),
        "stale_locks_removed": _prune_stale_locks(),
        "manifest_probe_dirs_removed": probes,
        "manifest_probe_bytes_removed": probe_bytes,
        "download_log_files_removed": download_logs,
        "download_log_bytes_removed": download_log_bytes,
        "media_cache_files_removed": media_files,
        "media_cache_bytes_removed": media_bytes,
        "old_tool_dirs_removed": old_tools,
        "old_tool_bytes_removed": old_tool_bytes,
    }


def _status_path(app_id: int) -> Path:
    return STATUS_ROOT / f"app-{app_id}.json"


def _read_status(app_id: int) -> dict[str, Any] | None:
    path = _status_path(app_id)
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _staging_candidates() -> list[tuple[int, str, Path]]:
    result: list[tuple[int, str, Path]] = []
    if not DOWNLOAD_ROOT.is_dir():
        return result
    for provider_dir in DOWNLOAD_ROOT.iterdir():
        if _digital_protected(provider_dir) or provider_dir.is_symlink() or not provider_dir.is_dir() or provider_dir.name in {"logs", "status"}:
            continue
        provider_id = provider_dir.name
        for child in provider_dir.iterdir():
            if child.is_symlink() or not child.is_dir() or not child.name.endswith("-download"):
                continue
            raw_id = child.name.removesuffix("-download")
            if raw_id.isdigit() and int(raw_id) > 0:
                result.append((int(raw_id), provider_id, child))
    return sorted(result, key=lambda item: (item[0], item[1]))


def remove_staging(app_id: int, provider_id: str, *, remove_manifest_probe: bool = True) -> dict[str, Any]:
    if app_id <= 0 or not provider_id or provider_id in {".", ".."} or any(separator in provider_id for separator in ("/", "\\", "\0")):
        raise ValueError("Invalid app or provider identity for staging cleanup")
    provider_root = DOWNLOAD_ROOT / provider_id
    staging = provider_root / f"{app_id}-download"
    manifest_probe = provider_root / f"{app_id}-manifest-only"
    root = DOWNLOAD_ROOT.resolve()
    removed: list[str] = []
    for path in (staging, manifest_probe if remove_manifest_probe else None):
        if path is None or not path.exists():
            continue
        if _digital_protected(path):
            raise RuntimeError(f"Digital folders are excluded from GameAccess cleanup: {path}")
        if path.is_symlink():
            raise RuntimeError(f"Refusing to remove symbolic-link staging path: {path}")
        try:
            path.resolve().relative_to(root)
        except (OSError, ValueError):
            raise RuntimeError(f"Refusing to remove path outside download root: {path}") from None
        shutil.rmtree(path)
        removed.append(str(path))
    _log(app_id, "staging-cleanup", provider_id=provider_id, removed=removed)
    return {"app_id": app_id, "provider_id": provider_id, "removed": removed}


def clear_status(app_id: int) -> None:
    path = _status_path(app_id)
    if _digital_protected(path):
        return
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    _log(app_id, "status-cleared")

