"""Shared by the managers: folder sizes, free space and whether a download plus its unpacking fits."""
from __future__ import annotations
import os
import shutil
from pathlib import Path

GIB = 1024 ** 3
# Disk needed to download AND unpack: the archive stays while its contents are written.
EXTRACTION_FACTOR = 2.0
SAFETY_MARGIN = 1 * GIB


def folder_size(folder: Path) -> int:
    """Total bytes under a folder; unreadable entries are skipped and links are not followed."""
    total = 0
    stack = [str(folder)]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    try:
                        if entry.is_symlink():
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        else:
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue
    return total


def disk_info(path: Path) -> dict:
    target = Path(path)
    while not target.exists() and target != target.parent:
        target = target.parent
    usage = shutil.disk_usage(target)
    return {"disk_total_bytes": usage.total, "disk_free_bytes": usage.free}


def check_space(download_bytes: int, games_root: Path, temporary_root: Path, factor: float = EXTRACTION_FACTOR) -> dict:
    """Can `download_bytes` be downloaded and unpacked? Checks every disk that will be written."""
    needed = int(download_bytes * factor) + SAFETY_MARGIN
    disks = {}
    for label, path in (("juegos", games_root), ("descargas", temporary_root)):
        resolved = Path(path).resolve()
        disks.setdefault(os.path.splitdrive(str(resolved))[0] or str(resolved.anchor), (label, disk_info(path)["disk_free_bytes"]))
    short = [(label, free) for label, free in disks.values() if free < needed]
    if short:
        label, free = short[0]
        return {"ok": False, "needed_bytes": needed, "free_bytes": free,
                "message": f"No hay espacio para descargar y descomprimir este juego: hacen falta {needed / GIB:.1f} GB libres en la carpeta de {label} y hay {free / GIB:.1f} GB."}
    return {"ok": True, "needed_bytes": needed, "free_bytes": min(free for _, free in disks.values()), "message": ""}
