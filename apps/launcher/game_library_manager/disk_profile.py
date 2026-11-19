"""What each disk is (Seba, 2026-11-18): Manager › Space shows it, and the placement policy (storage.pick) prefers
the fastest disk for installing games.

Windows already knows what every disk is, so Game Access only asks it: `Get-PhysicalDisk` gives the bus (NVMe) and the
media (SSD, HDD), `Get-Disk` the model, and the spindle speed settles the SATA disks whose media comes back
unspecified (0 revolutions: a solid-state disk). A disk over USB is also marked as such: the same SSD reads much slower
there. Nothing is written to the disk and nothing is read from it (Seba, 2026-11-18: measuring a read speed wrote and
read 256 MB per disk, which froze Space while it ran and told us little more than the kind already does).

What was found is kept in `.cache/disk-profile.json`, keyed by the disk's letter and its volume serial, so another disk
plugged in with the same letter is looked at again. Read when Space opens and again with Space's "Rescan disks".
To order disks we use the typical speed of each kind (TYPICAL), not a measured one."""
from __future__ import annotations
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Iterable

from atomic_json import write_json

# Typical read speeds (MB/s), only to order one kind of disk before another.
TYPICAL = {"nvme": 2500, "ssd": 450, "hdd": 130, "unknown": 100}
# Over USB (or a card reader) even a solid-state disk reads a fraction of what it does inside the PC.
EXTERNAL_BUSES = {"usb", "sd", "mmc", "1394"}
EXTERNAL_FACTOR = 0.35
KIND_QUERY = r"""
$out = foreach ($p in Get-Partition | Where-Object DriveLetter) {
  $d = Get-Disk -Number $p.DiskNumber -ErrorAction SilentlyContinue
  $pd = Get-PhysicalDisk -ErrorAction SilentlyContinue | Where-Object { $_.DeviceId -eq [string]$p.DiskNumber }
  [pscustomobject]@{ letter = [string]$p.DriveLetter; bus = [string]$d.BusType; media = [string]$pd.MediaType;
                     spindle = [string]$pd.SpindleSpeed; model = [string]$d.FriendlyName }
}
@($out) | ConvertTo-Json -Compress
"""


def _no_window() -> int:
    return 0x08000000 if os.name == "nt" else 0


def _kind_of(bus: str, media: str, spindle: str) -> str:
    """What the disk is, from what Windows says about it."""
    if bus.lower() == "nvme":
        return "nvme"
    if media.upper() == "SSD":
        return "ssd"
    if media.upper() == "HDD":
        return "hdd"
    # A SATA disk whose media Windows leaves unspecified: no revolutions means solid state.
    try:
        turns = int(float(spindle))
    except (TypeError, ValueError):
        return "unknown"
    return "ssd" if turns == 0 else "hdd"


def kinds() -> dict[str, dict]:
    """{"C:": {"kind": "nvme" | "ssd" | "hdd" | "unknown", "bus": "...", "external": bool, "model": "..."}} for every
    disk with a letter. Empty when Windows cannot be asked (another system, or PowerShell failed)."""
    if os.name != "nt":
        return {}
    try:
        done = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", KIND_QUERY], capture_output=True,
                              text=True, timeout=30, creationflags=_no_window())
        rows = json.loads(done.stdout or "[]")
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}
    found = {}
    for row in rows if isinstance(rows, list) else [rows]:
        letter = f"{str(row.get('letter') or '').upper()}:"
        bus = str(row.get("bus") or "")
        kind = _kind_of(bus, str(row.get("media") or ""), str(row.get("spindle") or ""))
        found[letter] = {"kind": kind, "bus": bus, "external": bus.lower() in EXTERNAL_BUSES,
                         "model": str(row.get("model") or "").strip()}
    return found


def volume_serial(drive: str) -> int:
    if os.name != "nt":
        return 0
    try:
        import ctypes
        serial = ctypes.c_ulong(0)
        if ctypes.windll.kernel32.GetVolumeInformationW(drive if drive.endswith("\\") else drive + "\\", None, 0, ctypes.byref(serial), None, None, None, 0):
            return int(serial.value)
    except (OSError, AttributeError):
        pass
    return 0


class DiskProfiles:
    """What each disk is, kept between runs."""

    def __init__(self, data: Path):
        self.path = Path(data) / ".cache" / "disk-profile.json"

    def load(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def known(self, letter: str) -> dict | None:
        entry = self.load().get(letter)
        return entry if entry and entry.get("serial") == volume_serial(letter) else None

    def refresh(self, letters: Iterable[str], only_missing: bool = False) -> dict:
        """What each disk in `letters` is, asking Windows once for all of them. `only_missing`: the disks already
        looked at keep what was found (what Space does when it opens)."""
        current = self.load()
        wanted = [letter for letter in dict.fromkeys(letters) if not (only_missing and self.known(letter))]
        if not wanted:
            return current
        found = kinds()
        for letter in wanted:
            seen = found.get(letter, {})
            kind = seen.get("kind") or current.get(letter, {}).get("kind") or "unknown"
            current[letter] = {"serial": volume_serial(letter), "kind": kind, "bus": seen.get("bus", ""),
                               "external": bool(seen.get("external")), "model": seen.get("model", ""),
                               "seen_at": int(time.time())}
        write_json(self.path, current)
        return current


KIND_RANK = {"nvme": 3, "ssd": 2, "hdd": 1, "unknown": 0}


def rank_of(profile: dict | None) -> tuple[int, float]:
    """How disks are ordered for a game: by what they are first (an NVMe or SSD before a hard disk), then by the
    typical speed of that kind, which puts the same kind over USB last."""
    kind = (profile or {}).get("kind") or "unknown"
    return 0 if (profile or {}).get("external") else KIND_RANK.get(kind, 0), speed_of(profile)


def speed_of(profile: dict | None) -> float:
    """What to order disks by: the typical speed of its kind, a fraction of it when it hangs off a USB port."""
    if not profile:
        return TYPICAL["unknown"]
    typical = TYPICAL.get(profile.get("kind") or "unknown", TYPICAL["unknown"])
    return float(typical * EXTERNAL_FACTOR if profile.get("external") else typical)
