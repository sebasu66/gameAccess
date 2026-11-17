"""The single definition of what counts as an archive, a retained backup or a secondary volume."""
from __future__ import annotations
import re
from pathlib import Path

# What the options form offers as a fix archive.
ARCHIVE_SUFFIXES = (".zip", ".rar", ".7z", ".001")
_ARCHIVE = re.compile(r"\.(?:zip|rar|7z|tar|tar\.gz|tgz|001)$", re.I)
_BACKUP = re.compile(r"_backup(?:\.|$)|^backup for .*\.zip$", re.I)
_SECONDARY_VOLUME = re.compile(r"\.part(?!0*1\b)\d+\.rar$|\.(?!001\b)\d{3}$|\.z\d+$", re.I)


def is_backup_name(name: str) -> bool:
    """The retained fix archive ('<title>_backup.zip' or the legacy 'backup for ...zip')."""
    return bool(_BACKUP.search(name))


def is_secondary_volume(name: str) -> bool:
    """Volumes after the first of a multipart archive: extracting the first one reads them all."""
    return bool(_SECONDARY_VOLUME.search(name))


def pending_archives(folder: Path) -> list[Path]:
    """Archives still lying in a game folder, first volume only, retained backups excluded."""
    root = Path(folder)
    found = [p for p in root.rglob("*") if p.is_file() and not p.is_symlink() and _ARCHIVE.search(p.name)
             and not is_backup_name(p.name) and not is_secondary_volume(p.name)]
    return sorted(found, key=lambda p: (len(p.relative_to(root).parts), p.name.lower()))


def checked_archive(folder: Path, value: str) -> Path:
    """An archive inside the game folder, never a link: the file Play re-applies before launching."""
    candidate = folder / value
    target = candidate.resolve()
    if (not target.is_relative_to(folder.resolve()) or not target.is_file()
            or target.suffix.lower() not in ARCHIVE_SUFFIXES or candidate.is_symlink()):
        raise ValueError("Selecciona un archivo comprimido dentro de la carpeta del juego.")
    return target
