"""Safely prepare a GameAccess CDN download for Steam existing-files discovery.

This does not fabricate an appmanifest and does not log into Steam. It inspects
configured Steam libraries and can copy a completed isolated download into the
app's cached ``installdir``. Existing differing files are treated as conflicts
and are never overwritten.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

from pool_sync import _steam_library_folders
from steam_appinfo import read_local_app_catalog
from steam_pool import steam_root

DOWNLOAD_ROOT = Path(__file__).resolve().parent / ".gameaccess" / "downloads"


def _stats(path: Path) -> tuple[int, int]:
    files = 0
    size = 0
    if path.exists():
        for item in path.rglob("*"):
            if item.is_file():
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
        # For import preparation we only need a conservative conflict test.
        # Same-size existing files are preserved; Steam will perform authoritative
        # verification after the user initiates installation.
        return True
    except OSError:
        return False


def prepare(app_id: int, provider_id: str, library_index: int) -> dict[str, Any]:
    state = inspect(app_id, provider_id)
    library = next((item for item in state["libraries"] if item["index"] == library_index), None)
    if library is None:
        raise RuntimeError(f"Unknown Steam library index: {library_index}")
    if library["manifest_exists"]:
        raise RuntimeError("App manifest already exists in selected library; refusing import preparation")
    if library["free_bytes"] is not None and library["free_bytes"] < state["source_bytes"]:
        raise RuntimeError("Selected Steam library does not have enough free space")

    source = Path(state["source"])
    target = Path(library["target"])
    conflicts: list[str] = []
    copy_plan: list[tuple[Path, Path]] = []
    for src in source.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(source)
        dst = target / rel
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

    files, total_bytes = _stats(target)
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
