"""Filesystem reconciliation helpers for GameAccess-managed Steam downloads.

This module deliberately owns only local download-staging cleanup/recovery.
It does not launch Steam, switch accounts, or decide UI behavior.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from download_log import append_download_log
from steam_prepare_import import app_metadata
from pool_sync import _steam_library_folders
from steam_pool import steam_root

RUNTIME_ROOT = Path(os.environ.get("GAMEACCESS_DATA_DIR") or (Path(__file__).resolve().parent / ".gameaccess"))
DOWNLOAD_ROOT = RUNTIME_ROOT / "downloads"
STATUS_ROOT = DOWNLOAD_ROOT / "status"
LOG_ROOT = DOWNLOAD_ROOT / "logs"


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
    append_download_log(LOG_ROOT, app_id, body)


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
        if provider_dir.is_symlink() or not provider_dir.is_dir() or provider_dir.name in {"logs", "status"}:
            continue
        provider_id = provider_dir.name
        for child in provider_dir.iterdir():
            if child.is_symlink() or not child.is_dir() or not child.name.endswith("-download"):
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
    install_path = Path(install_dir)
    if install_path.is_absolute() or len(install_path.parts) != 1 or install_dir in {".", ".."}:
        raise ValueError(f"Unsafe Steam install directory for AppID {app_id}")
    libraries: list[dict[str, Any]] = []
    if root is not None:
        for library in _steam_library_folders(root):
            library_root = Path(library["path"])
            manifest = library_root / "steamapps" / f"appmanifest_{app_id}.acf"
            common_root = library_root / "steamapps" / "common"
            target = common_root / install_dir
            try:
                target.resolve().relative_to(common_root.resolve())
            except (OSError, ValueError):
                continue
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
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    _log(app_id, "status-cleared")


def reconcile() -> list[dict[str, Any]]:
    """Find recoverable staging; remove only payloads proven duplicated in Steam."""
    interrupted: list[dict[str, Any]] = []
    staging_candidates = _staging_candidates()
    for app_id, provider_id, staging in staging_candidates:
        status = _read_status(app_id) or {}
        if status.get("state") in {"requested", "preparing", "downloading", "paused", "cancelling"}:
            # The Tauri caller marks dead workers interrupted before invoking this scan.
            # A still-active worker owns its directory and must not be offered for deletion.
            continue

        bytes_present = _directory_bytes(staging)
        if not _regular_files(staging):
            remove_staging(app_id, provider_id, remove_manifest_probe=False)
            if status.get("state") == "interrupted":
                clear_status(app_id)
            _log(app_id, "reconcile-empty-staging-removed", provider_id=provider_id)
            continue

        observation = {"libraries": [], "steam_installed": False}
        if status.get("state") in {"prepared", "installed"}:
            try:
                observation = steam_install_observation(app_id)
            except Exception as exc:
                _log(app_id, "reconcile-steam-observation-failed", error=str(exc)[:500])

        candidates = [item for item in observation.get("libraries", []) if item.get("target_exists")]
        if status.get("prepared_target"):
            prepared_target = Path(str(status["prepared_target"]))
            candidates.sort(key=lambda item: Path(item["target"]).resolve() != prepared_target.resolve())
        for candidate in candidates:
            target = Path(candidate["target"])
            if _payload_matches(staging, target):
                remove_staging(app_id, provider_id, remove_manifest_probe=False)
                if candidate.get("steam_installed"):
                    clear_status(app_id)
                _log(app_id, "reconcile-verified-steam-copy", provider_id=provider_id, target=str(target))
                break
        else:
            interrupted.append(_interrupted_status(app_id, provider_id, status, bytes_present))
            _log(app_id, "reconcile-interrupted", provider_id=provider_id, bytes_present=bytes_present)

    # Steam owns uninstalling game payloads. Once Steam has removed both its
    # manifest and install directory, discard only stale GameAccess status JSON;
    # never infer that a resumable staging folder is obsolete from this check.
    staged_app_ids = {app_id for app_id, _provider_id, _path in staging_candidates}
    if STATUS_ROOT.is_dir() and not STATUS_ROOT.is_symlink():
        for status_path in STATUS_ROOT.iterdir():
            if status_path.is_symlink() or not status_path.is_file():
                continue
            prefix, suffix = status_path.stem, status_path.suffix
            if suffix != ".json" or not prefix.startswith("app-"):
                continue
            raw_app_id = prefix.removeprefix("app-")
            if not raw_app_id.isdigit() or int(raw_app_id) <= 0:
                continue
            app_id = int(raw_app_id)
            if app_id in staged_app_ids:
                continue
            status = _read_status(app_id)
            if not status or status.get("app_id") != app_id or status.get("state") not in {"prepared", "installed"}:
                continue
            try:
                observation = steam_install_observation(app_id)
            except Exception as exc:
                _log(app_id, "stale-status-check-failed", error=str(exc)[:500])
                continue
            libraries = observation.get("libraries", [])
            if libraries and all(not item.get("manifest_exists") and not item.get("target_exists") for item in libraries):
                clear_status(app_id)
                _log(app_id, "uninstalled-game-status-pruned")
    return interrupted


def _payload_matches(source: Path, target: Path) -> bool:
    """Require every regular staged file to match its Steam copy byte-for-byte."""
    if source.is_symlink() or target.is_symlink() or not source.is_dir() or not target.is_dir():
        return False
    source_files = sorted(item for item in source.rglob("*") if not item.is_symlink() and item.is_file())
    if not source_files:
        return False
    for src in source_files:
        dst = target / src.relative_to(source)
        if dst.is_symlink() or not dst.is_file():
            return False
        try:
            if src.stat().st_size != dst.stat().st_size:
                return False
            with src.open("rb") as source_file, dst.open("rb") as target_file:
                while True:
                    source_chunk = source_file.read(1024 * 1024)
                    target_chunk = target_file.read(1024 * 1024)
                    if source_chunk != target_chunk:
                        return False
                    if not source_chunk:
                        break
        except OSError:
            return False
    return True


def _interrupted_status(app_id: int, provider_id: str, status: dict[str, Any], bytes_present: int) -> dict[str, Any]:
    return {
        "app_id": app_id,
        "state": "interrupted",
        "progress": status.get("progress"),
        "bytes_downloaded": status.get("bytes_downloaded") or bytes_present,
        "bytes_total": status.get("bytes_total"),
        "speed_bps": None,
        "eta_seconds": None,
        "installed": False,
        "provider_id": provider_id,
        "prepared_target": None,
        "library_index": status.get("library_index"),
        "error": None,
        "job_id": status.get("job_id") or f"recovered-{app_id}",
        "worker_pid": None,
    }


def discard_interrupted(app_id: int, provider_id: str, job_id: str) -> dict[str, Any]:
    status = _read_status(app_id) or {}
    if status.get("state") != "interrupted" or status.get("provider_id") != provider_id or status.get("job_id") != job_id:
        raise RuntimeError("Download changed since the recovery prompt; staging was preserved")
    removed = remove_staging(app_id, provider_id, remove_manifest_probe=False)
    clear_status(app_id)
    _log(app_id, "interrupted-download-discarded", provider_id=provider_id, job_id=job_id)
    return removed


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile or discard GameAccess download staging")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--reconcile", action="store_true")
    mode.add_argument("--discard", action="store_true")
    parser.add_argument("--app-id", type=int)
    parser.add_argument("--provider-id")
    parser.add_argument("--job-id")
    args = parser.parse_args()
    try:
        if args.reconcile:
            result: Any = reconcile()
        else:
            if not args.app_id or not args.provider_id or not args.job_id:
                parser.error("--discard requires --app-id, --provider-id and --job-id")
            result = discard_interrupted(args.app_id, args.provider_id, args.job_id)
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)[:1200]}, ensure_ascii=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
