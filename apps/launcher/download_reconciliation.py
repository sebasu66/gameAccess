"""Filesystem reconciliation helpers for GameAccess-managed Steam downloads.

This module deliberately owns only local download-staging cleanup/recovery.
It does not launch Steam, switch accounts, or decide UI behavior.
"""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from steam_prepare_import import app_metadata
from pool_sync import _steam_library_folders
from steam_pool import steam_root

RUNTIME_ROOT = Path(__file__).resolve().parent / ".gameaccess"
DOWNLOAD_ROOT = RUNTIME_ROOT / "downloads"
STATUS_ROOT = DOWNLOAD_ROOT / "status"
LOG_ROOT = DOWNLOAD_ROOT / "logs"


def _directory_bytes(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for item in path.rglob("*"):
        if not item.is_file():
            continue
        try:
            total += item.stat().st_size
        except OSError:
            pass
    return total


def _log(app_id: int, event: str, **details: Any) -> None:
    LOG_ROOT.mkdir(parents=True, exist_ok=True)
    body = {
        "at": datetime.now(timezone.utc).isoformat(),
        "app_id": app_id,
        "event": event,
        **details,
    }
    with (LOG_ROOT / f"app-{app_id}.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(body, ensure_ascii=True) + "\n")


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
        if not provider_dir.is_dir() or provider_dir.name in {"logs", "status"}:
            continue
        provider_id = provider_dir.name
        for child in provider_dir.iterdir():
            if not child.is_dir() or not child.name.endswith("-download"):
                continue
            raw_id = child.name.removesuffix("-download")
            if raw_id.isdigit() and int(raw_id) > 0:
                result.append((int(raw_id), provider_id, child))
    return sorted(result, key=lambda item: (item[0], item[1]))


def steam_install_observation(app_id: int) -> dict[str, Any]:
    """Observe Steam's final install state without trusting GameAccess status JSON."""
    root = steam_root()
    metadata = app_metadata(app_id)
    install_dir = str(metadata["install_dir"])
    libraries: list[dict[str, Any]] = []
    if root is not None:
        for library in _steam_library_folders(root):
            library_root = Path(library["path"])
            manifest = library_root / "steamapps" / f"appmanifest_{app_id}.acf"
            target = library_root / "steamapps" / "common" / install_dir
            state_flags = 0
            if manifest.is_file():
                try:
                    text = manifest.read_text(encoding="utf-8", errors="replace")
                    for line in text.splitlines():
                        parts = line.split('"')
                        if len(parts) >= 4 and parts[1].casefold() == "stateflags":
                            state_flags = int(parts[3] or 0)
                            break
                except (OSError, ValueError):
                    state_flags = 0
            libraries.append({
                "index": int(library["index"]),
                "root": str(library_root),
                "manifest_exists": manifest.is_file(),
                "state_flags": state_flags,
                "steam_installed": bool(manifest.is_file() and state_flags & 4 == 4),
                "target": str(target),
                "target_exists": target.is_dir(),
            })
    return {
        "app_id": app_id,
        "install_dir": install_dir,
        "libraries": libraries,
        "steam_installed": any(item["steam_installed"] for item in libraries),
    }


def remove_staging(app_id: int, provider_id: str, *, remove_manifest_probe: bool = True) -> dict[str, Any]:
    provider_root = DOWNLOAD_ROOT / provider_id
    staging = provider_root / f"{app_id}-download"
    manifest_probe = provider_root / f"{app_id}-manifest-only"
    removed: list[str] = []
    for path in (staging, manifest_probe if remove_manifest_probe else None):
        if path is None or not path.exists():
            continue
        shutil.rmtree(path)
        removed.append(str(path))
    _log(app_id, "staging-cleanup", provider_id=provider_id, removed=removed)
    return {"app_id": app_id, "provider_id": provider_id, "removed": removed}


def clear_status(app_id: int) -> None:
    path = _status_path(app_id)
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    _log(app_id, "status-cleared")


def reconcile() -> list[dict[str, Any]]:
    """Return unresolved interrupted downloads and remove definitely redundant staging."""
    interrupted: list[dict[str, Any]] = []
    for app_id, provider_id, staging in _staging_candidates():
        bytes_present = _directory_bytes(staging)
        if bytes_present <= 0:
            remove_staging(app_id, provider_id)
            continue

        status = _read_status(app_id) or {}
        observation = steam_install_observation(app_id)

        # Once Steam has an authoritative installed manifest, GameAccess staging is redundant.
        if observation["steam_installed"]:
            remove_staging(app_id, provider_id)
            clear_status(app_id)
            _log(app_id, "reconcile-steam-installed", provider_id=provider_id)
            continue

        # A provider job that already finished copying into Steam no longer needs the bulky source.
        # Keep the tiny prepared status so Play can finish Steam discovery/validation.
        if status.get("state") == "prepared" and status.get("prepared_target"):
            target = Path(str(status["prepared_target"]))
            if target.is_dir():
                remove_staging(app_id, provider_id)
                _log(app_id, "reconcile-prepared-target", provider_id=provider_id, target=str(target))
                continue

        recovered = {
            "app_id": app_id,
            "state": "interrupted",
            "progress": status.get("progress"),
            "bytes_downloaded": status.get("bytes_downloaded") or bytes_present,
            "bytes_total": status.get("bytes_total"),
            "speed_bps": None,
            "eta_seconds": None,
            "installed": False,
            "provider_id": status.get("provider_id") or provider_id,
            "prepared_target": None,
            "library_index": status.get("library_index"),
            "error": None,
            "job_id": status.get("job_id") or f"recovered-{app_id}",
            "worker_pid": None,
        }
        interrupted.append(recovered)
        _log(app_id, "reconcile-interrupted", provider_id=provider_id, bytes_present=bytes_present)
    return interrupted
