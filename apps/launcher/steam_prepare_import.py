"""Safely prepare a GameAccess CDN download for Steam existing-files discovery.

This does not fabricate an appmanifest and does not log into Steam. It inspects
configured Steam libraries and can copy a completed isolated download into the
app's cached ``installdir``. Existing differing files are treated as conflicts
and are never overwritten.
"""
from __future__ import annotations

import os
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from pool_sync import _steam_library_folders
from steam_appinfo import read_local_app_catalog
from steam_pool import steam_root

DOWNLOAD_ROOT = Path(os.environ.get("GAMEACCESS_DATA_DIR") or (Path(__file__).resolve().parent / ".gameaccess")) / "downloads"


def _stats(path: Path) -> tuple[int, int]:
    files = 0
    size = 0
    if path.exists():
        for item in path.rglob("*"):
            if not item.is_symlink() and item.is_file():
                files += 1
                try:
                    size += item.stat().st_size
                except OSError:
                    pass
    return files, size


def app_metadata(app_id: int) -> dict[str, Any]:
    root = steam_root()
    if root is None:
        raise RuntimeError("Steam root not found")
    catalog = read_local_app_catalog(root / "appcache" / "appinfo.vdf", {app_id})
    item = catalog.get(app_id)
    if not item:
        raise RuntimeError(f"AppID {app_id} is missing from local appinfo")
    install_dir = str(item.get("install_dir") or "").strip()
    if not install_dir:
        raise RuntimeError(f"AppID {app_id} has no cached install_dir")
    return item


def inspect(app_id: int, provider_id: str) -> dict[str, Any]:
    root = steam_root()
    metadata = app_metadata(app_id)
    source = DOWNLOAD_ROOT / provider_id / f"{app_id}-download"
    source_files, source_bytes = _stats(source)
    libraries: list[dict[str, Any]] = []
    for library in _steam_library_folders(root):
        library_root = Path(library["path"])
        manifest = library_root / "steamapps" / f"appmanifest_{app_id}.acf"
        target = library_root / "steamapps" / "common" / metadata["install_dir"]
        target_files, target_bytes = _stats(target)
        try:
            free_bytes = shutil.disk_usage(library_root).free
        except OSError:
            free_bytes = None
        libraries.append(
            {
                "index": library["index"],
                "path": str(library_root),
                "manifest_exists": manifest.is_file(),
                "manifest_path": str(manifest),
                "target": str(target),
                "target_exists": target.exists(),
                "target_file_count": target_files,
                "target_bytes": target_bytes,
                "free_bytes": free_bytes,
            }
        )
    return {
        "ok": source.is_dir() and source_files > 0,
        "app_id": app_id,
        "provider_id": provider_id,
        "name": metadata.get("name"),
        "install_dir": metadata["install_dir"],
        "launch": metadata.get("launch", []),
        "source": str(source),
        "source_file_count": source_files,
        "source_bytes": source_bytes,
        "libraries": libraries,
    }


def _files_equal(left: Path, right: Path) -> bool:
    try:
        if left.stat().st_size != right.stat().st_size:
            return False
        def digest(path: Path) -> bytes:
            value = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    value.update(chunk)
            return value.digest()
        return digest(left) == digest(right)
    except OSError:
        return False


def prepare(app_id: int, provider_id: str, library_index: int) -> dict[str, Any]:
    if (
        app_id <= 0
        or not provider_id
        or provider_id in {".", ".."}
        or any(separator in provider_id for separator in ("/", "\\", "\0"))
    ):
        raise ValueError("Invalid app or provider identity for Steam preparation")
    state = inspect(app_id, provider_id)
    library = next((item for item in state["libraries"] if item["index"] == library_index), None)
    if library is None:
        raise RuntimeError(f"Unknown Steam library index: {library_index}")
    if library["manifest_exists"]:
        raise RuntimeError("App manifest already exists in selected library; refusing import preparation")
    if library["free_bytes"] is not None and library["free_bytes"] < state["source_bytes"]:
        raise RuntimeError("Selected Steam library does not have enough free space")

    source = Path(state["source"])
    if source.is_symlink() or not source.is_dir():
        raise RuntimeError("GameAccess staging directory is missing or unsafe")
    try:
        source.resolve().relative_to(DOWNLOAD_ROOT.resolve())
    except (OSError, ValueError):
        raise RuntimeError("GameAccess staging directory is outside the download root") from None
    source_files = sorted(
        item
        for item in source.rglob("*")
        if not item.is_symlink() and item.is_file()
    )
    if not source_files:
        raise RuntimeError("GameAccess staging contains no files to prepare")
    target = Path(library["target"])
    common_root = Path(library["path"]) / "steamapps" / "common"
    try:
        target.resolve().relative_to(common_root.resolve())
    except (OSError, ValueError):
        raise RuntimeError("Steam install target is outside steamapps/common") from None
    if target.is_symlink():
        raise RuntimeError("Steam install target is a symbolic link; refusing preparation")
    conflicts: list[str] = []
    copy_plan: list[tuple[Path, Path]] = []
    for src in source_files:
        rel = src.relative_to(source)
        dst = target / rel
        parent = dst.parent
        while parent != target.parent:
            if parent.is_symlink():
                conflicts.append(str(rel))
                break
            parent = parent.parent
        if str(rel) in conflicts:
            continue
        if dst.is_symlink():
            conflicts.append(str(rel))
            continue
        if dst.exists():
            if not _files_equal(src, dst):
                conflicts.append(str(rel))
            continue
        copy_plan.append((src, dst))

    if conflicts:
        return {
            "ok": False,
            "prepared": False,
            "reason": "existing_file_conflicts",
            "conflict_count": len(conflicts),
            "conflicts": conflicts[:50],
            "target": str(target),
        }

    copied_bytes = 0
    for src, dst in copy_plan:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied_bytes += src.stat().st_size

    # Verify every staged relative path exists in Steam with the expected size
    # before removing the only recoverable copy of the downloaded payload.
    verified_bytes = 0
    for src in source_files:
        dst = target / src.relative_to(source)
        if not dst.is_file() or dst.is_symlink() or dst.stat().st_size != src.stat().st_size:
            raise RuntimeError(f"Steam copy verification failed for {src.relative_to(source)}")
        verified_bytes += src.stat().st_size
    if verified_bytes != state["source_bytes"]:
        raise RuntimeError("Steam copy verification failed: source payload changed during preparation")

    files, total_bytes = _stats(target)
    staging_removed = False
    cleanup_error = None
    try:
        shutil.rmtree(source)
        staging_removed = True
    except OSError as exc:
        cleanup_error = str(exc)
    return {
        "ok": True,
        "prepared": True,
        "app_id": app_id,
        "provider_id": provider_id,
        "library_index": library_index,
        "target": str(target),
        "copied_file_count": len(copy_plan),
        "copied_bytes": copied_bytes,
        "target_file_count": files,
        "target_bytes": total_bytes,
        "verified_source_file_count": len(source_files),
        "verified_source_bytes": verified_bytes,
        "staging_removed": staging_removed,
        "staging_cleanup_error": cleanup_error,
        "next_manual_test": "Log the owning provider into Steam, choose Install for this AppID in the selected library, and verify Steam discovers/validates the existing files before Play.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare GameAccess-downloaded files for Steam discovery")
    parser.add_argument("--app-id", type=int, required=True)
    parser.add_argument("--provider-id", required=True)
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--library-index", type=int)
    args = parser.parse_args()

    if args.inspect == args.prepare:
        parser.error("select exactly one of --inspect or --prepare")
    if args.prepare and args.library_index is None:
        parser.error("--prepare requires --library-index")

    result = (
        inspect(args.app_id, args.provider_id)
        if args.inspect
        else prepare(args.app_id, args.provider_id, args.library_index)
    )
    print(json.dumps(result, ensure_ascii=True))
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
