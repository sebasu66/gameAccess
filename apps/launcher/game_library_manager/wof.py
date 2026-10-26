"""Windows file compression (WOF, what `compact /exe` does), one file at a time, so many files can be compressed at
once on different threads. `compact.exe` works through the files one by one on a single core.

    compress(path)    the file is stored compressed (LZX by default); reading it stays the same for every program
    uncompress(path)  back to a normal file

Both return 0 when done or when there was nothing to do, else the Windows error code (a file in use, say)."""
from __future__ import annotations
import ctypes
import sys
from pathlib import Path

LZX, XPRESS16K = 1, 3
FSCTL_SET_EXTERNAL_BACKING, FSCTL_DELETE_EXTERNAL_BACKING = 0x9030C, 0x90314
WOF_PROVIDER_FILE = 2
GENERIC_READ, GENERIC_WRITE = 0x80000000, 0x40000000
OPEN_EXISTING, FILE_SHARE_READ = 3, 1
# Not worth compressing (Windows decides) and already a normal file: nothing to do, not a failure.
COMPRESSION_NOT_BENEFICIAL, NOT_EXTERNALLY_BACKED = 344, 342

_kernel = None
if sys.platform == "win32":
    from ctypes import wintypes
    _kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    _kernel.CreateFileW.restype = wintypes.HANDLE
    _kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    _kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    _kernel.DeviceIoControl.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p,
                                        wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
    _INVALID = wintypes.HANDLE(-1).value


def available() -> bool:
    return _kernel is not None


def _control(path: Path, access: int, code: int, payload=None) -> int:
    handle = _kernel.CreateFileW("\\\\?\\" + str(Path(path).resolve()), access, FILE_SHARE_READ, None, OPEN_EXISTING, 0, None)
    if handle == _INVALID:
        return ctypes.get_last_error()
    try:
        returned = wintypes.DWORD()
        size = ctypes.sizeof(payload) if payload is not None else 0
        ok = _kernel.DeviceIoControl(handle, code, ctypes.byref(payload) if payload is not None else None, size, None, 0, ctypes.byref(returned), None)
        return 0 if ok else ctypes.get_last_error()
    finally:
        _kernel.CloseHandle(handle)


def compress(path: Path, algorithm: int = LZX) -> int:
    # WOF_EXTERNAL_INFO {version 1, the file provider} followed by FILE_PROVIDER_EXTERNAL_INFO_V1 {version 1, algorithm, flags}.
    payload = (ctypes.c_ulong * 5)(1, WOF_PROVIDER_FILE, 1, algorithm, 0)
    code = _control(path, GENERIC_READ, FSCTL_SET_EXTERNAL_BACKING, payload)
    return 0 if code == COMPRESSION_NOT_BENEFICIAL else code


def uncompress(path: Path) -> int:
    # Opening a compressed file for writing may already bring it back; then Windows says it is not compressed.
    code = _control(path, GENERIC_READ | GENERIC_WRITE, FSCTL_DELETE_EXTERNAL_BACKING)
    return 0 if code == NOT_EXTERNALLY_BACKED else code
