"""Shared by the managers: folder sizes, free space and whether a download plus its unpacking fits."""
from __future__ import annotations
import os
import shutil
from pathlib import Path
from game_download_manager.ui_text import ui

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


def allocated_size(folder: Path) -> int:
    """Bytes a folder really takes on disk. A torrent creates its files at full size but sparse, so a half-done
    100 GB download reads as 100 GB by length: only what is allocated is what already arrived."""
    total = 0
    for path in Path(folder).rglob("*"):
        try:
            if path.is_symlink() or not path.is_file():
                continue
            total += _allocated(path)
        except OSError:
            continue
    return total


def _allocated(path: Path) -> int:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        get_size = ctypes.windll.kernel32.GetCompressedFileSizeW
        get_size.argtypes = (wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD))
        get_size.restype = wintypes.DWORD
        high = wintypes.DWORD(0)
        low = get_size(str(path), ctypes.byref(high))
        if low == 0xFFFFFFFF and ctypes.GetLastError() != 0:
            return path.stat().st_size
        return (high.value << 32) + low
    blocks = getattr(path.stat(), "st_blocks", None)
    return blocks * 512 if blocks is not None else path.stat().st_size


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


def check_download(total_bytes: int, on_disk_bytes: int, games_root: Path, temporary_root: Path) -> dict:
    """Before the transfer, once its size is known: what is still to download lands in the temporary folder and the
    unpacked game (about as big again) in the games folder; on one disk both add up. What already arrived counts."""
    remaining = max(0, int(total_bytes) - int(on_disk_bytes))
    wanted: dict[str, list] = {}
    for label, path, size in (("dlNoSpaceDownloads", temporary_root, remaining), ("dlNoSpaceGames", games_root, int(total_bytes))):
        resolved = Path(path).resolve()
        drive = os.path.splitdrive(str(resolved))[0] or str(resolved.anchor)
        entry = wanted.setdefault(drive, [label, disk_info(path)["disk_free_bytes"], SAFETY_MARGIN])
        entry[2] += size
    for label, free, needed in wanted.values():
        if free < needed:
            return {"ok": False, "needed_bytes": needed, "free_bytes": free,
                    # A key of the app's translations (game_download_manager.ui_text): the app says it in its language.
                    "message": ui(label, needed=f"{needed / GIB:.1f}", free=f"{free / GIB:.1f}")}
    return {"ok": True, "needed_bytes": max(n for _, _, n in wanted.values()), "free_bytes": min(f for _, f, _ in wanted.values()), "message": ""}
