"""What keeps freezing safe: one freeze or thaw at a time in the whole app (a lock naming its process), and the
signals the app sends to the work going on, as small files next to the freeze records:

    <records>/freeze.lock       {"pid", "app_id", "action", "started"}: who is freezing or thawing now
    <records>/<appid>.cancel    the app asked to cancel that game's work
    <records>/freeze.pause      the app asked the work to wait (a game is being played)

The work looks at them between two pieces of work (a file, a moment of 7-Zip), so a cancel or a pause takes effect
within a second or so. A lock whose process is gone (the app was closed, the computer went off) is taken over.
"""
from __future__ import annotations
import ctypes
import json
import os
import sys
import time
from pathlib import Path

LOCK, PAUSE = "freeze.lock", "freeze.pause"
BELOW_NORMAL = 0x00004000          # Windows priority class: the work never slows down the app or a game
_STILL_ACTIVE, _QUERY, _SUSPEND_RESUME = 259, 0x1000, 0x0800


class FreezeBusy(RuntimeError):
    """Another game is being frozen or thawed: one at a time."""


class FreezeCancelled(RuntimeError):
    """The app asked to cancel; the game was put back as it was."""


def pid_alive(pid) -> bool:
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if sys.platform != "win32":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel.OpenProcess(_QUERY, False, pid)
    if not handle:
        return False
    try:
        code = ctypes.c_ulong(0)
        return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == _STILL_ACTIVE
    finally:
        kernel.CloseHandle(handle)


def _suspend(pid: int, resume: bool) -> None:
    """Freeze (or wake) a whole process, 7-Zip here: its threads stop where they are and go on from there."""
    if sys.platform != "win32":
        return
    kernel, ntdll = ctypes.WinDLL("kernel32"), ctypes.WinDLL("ntdll")
    handle = kernel.OpenProcess(_SUSPEND_RESUME, False, int(pid))
    if handle:
        try:
            (ntdll.NtResumeProcess if resume else ntdll.NtSuspendProcess)(handle)
        finally:
            kernel.CloseHandle(handle)


def suspend(pid: int) -> None:
    _suspend(pid, False)


def resume(pid: int) -> None:
    _suspend(pid, True)


def lower_priority() -> None:
    """This process (and the threads that compress) below normal: the rest of the computer comes first."""
    if sys.platform == "win32":
        kernel = ctypes.WinDLL("kernel32")
        kernel.SetPriorityClass(kernel.GetCurrentProcess(), BELOW_NORMAL)


def holder(records: Path) -> dict | None:
    """Who holds the lock now, if that process is still alive."""
    try:
        owner = json.loads((records / LOCK).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return owner if pid_alive(owner.get("pid")) else None


class FreezeControl:
    """The lock and the signals for one game's freeze or thaw."""

    def __init__(self, records: Path, app_id: int, sleep=time.sleep):
        self.records, self.app_id, self.sleep = records, int(app_id), sleep
        self.held = False

    @property
    def _cancel_file(self) -> Path:
        return self.records / f"{self.app_id}.cancel"

    def acquire(self, action: str, priority: bool = False) -> None:
        """Take the lock, or refuse when another live process holds it. `priority`: a thaw the player waits for (Play
        on a deep-frozen game) goes ahead without the lock while the work holding it waits (it is paused)."""
        self.records.mkdir(parents=True, exist_ok=True)
        owner = holder(self.records)
        if owner and int(owner.get("pid", 0)) != os.getpid():
            if priority:
                return
            raise FreezeBusy(f"Ya se está {'descongelando' if str(owner.get('action', '')).startswith('thaw') else 'congelando'} otro juego: "
                             "esperá a que termine (queda en cola) o cancelalo.")
        self._cancel_file.unlink(missing_ok=True)   # a cancel left from an earlier run is not for this one
        record = {"pid": os.getpid(), "app_id": self.app_id, "action": action, "started": round(time.time(), 1)}
        temporary = self.records / f"{LOCK}.{os.getpid()}"
        temporary.write_text(json.dumps(record), encoding="utf-8")
        os.replace(temporary, self.records / LOCK)
        self.held = True

    def release(self) -> None:
        if self.held:
            try:
                owner = json.loads((self.records / LOCK).read_text(encoding="utf-8"))
                if int(owner.get("pid", 0)) == os.getpid():
                    (self.records / LOCK).unlink(missing_ok=True)
            except (OSError, ValueError):
                pass
            self.held = False
        self._cancel_file.unlink(missing_ok=True)

    def cancelled(self) -> bool:
        return self._cancel_file.exists()

    def paused(self) -> bool:
        return (self.records / PAUSE).exists()

    def checkpoint(self) -> None:
        """Between two pieces of work: wait while paused, stop when cancelled."""
        while self.paused() and not self.cancelled():
            self.sleep(0.5)
        if self.cancelled():
            raise FreezeCancelled("Cancelado: el juego quedó como estaba.")
