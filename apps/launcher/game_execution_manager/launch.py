"""Starting a game process: argument parsing, executable checks, UAC elevation and error-dialog detection."""
from __future__ import annotations
import ctypes
import shlex
import subprocess
import sys
from pathlib import Path


def parse_arguments(value):
    if "\n" in value or "\r" in value or "\x00" in value:
        raise ValueError("Los argumentos no pueden contener saltos de línea.")
    if sys.platform != "win32":
        return shlex.split(value)
    from ctypes import wintypes
    shell = ctypes.WinDLL("shell32", use_last_error=True)
    shell.CommandLineToArgvW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    shell.CommandLineToArgvW.restype = ctypes.POINTER(wintypes.LPWSTR)
    count = ctypes.c_int()
    argv = shell.CommandLineToArgvW('game.exe ' + value, ctypes.byref(count))
    if not argv:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return [argv[i] for i in range(1, count.value)]
    finally:
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        kernel.LocalFree(argv)


def checked_executable(folder, value):
    candidate = folder / value
    target = candidate.resolve()
    if not target.is_relative_to(folder.resolve()) or not target.is_file() or target.suffix.lower() != ".exe":
        raise ValueError("Selecciona un archivo .exe dentro de la carpeta del juego.")
    if candidate.is_symlink() or any(p.is_symlink() or (hasattr(p, "is_junction") and p.is_junction())
                                     for p in [candidate, *candidate.parents] if p != folder.parent):
        raise ValueError("El ejecutable no puede estar en un enlace.")
    return target


def launch_as_administrator(executable, arguments, working_dir):
    """Use Windows UAC; cancellation is reported, never retried as a different exe."""
    if sys.platform != "win32":
        raise ValueError("La ejecución como administrador solo está disponible en Windows.")
    from ctypes import wintypes
    class ShellExecuteInfo(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("fMask", wintypes.ULONG), ("hwnd", wintypes.HWND),
                    ("lpVerb", wintypes.LPCWSTR), ("lpFile", wintypes.LPCWSTR),
                    ("lpParameters", wintypes.LPCWSTR), ("lpDirectory", wintypes.LPCWSTR),
                    ("nShow", ctypes.c_int), ("hInstApp", wintypes.HINSTANCE),
                    ("lpIDList", ctypes.c_void_p), ("lpClass", wintypes.LPCWSTR),
                    ("hkeyClass", wintypes.HKEY), ("dwHotKey", wintypes.DWORD),
                    ("hIcon", wintypes.HANDLE), ("hProcess", wintypes.HANDLE)]
    shell = ctypes.WinDLL("shell32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    shell.ShellExecuteExW.argtypes = [ctypes.POINTER(ShellExecuteInfo)]
    shell.ShellExecuteExW.restype = wintypes.BOOL
    kernel.GetProcessId.argtypes = [wintypes.HANDLE]
    kernel.GetProcessId.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    info = ShellExecuteInfo()
    info.cbSize, info.fMask = ctypes.sizeof(info), 0x40 | 0x100
    info.lpVerb, info.lpFile = "runas", str(executable)
    info.lpParameters, info.lpDirectory, info.nShow = subprocess.list2cmdline(arguments), str(working_dir), 1
    if not shell.ShellExecuteExW(ctypes.byref(info)):
        error = ctypes.get_last_error()
        if error == 1223:
            raise ValueError("Se canceló la autorización de administrador.")
        raise ctypes.WinError(error)
    pid = kernel.GetProcessId(info.hProcess) if info.hProcess else None
    if info.hProcess:
        kernel.CloseHandle(info.hProcess)
    return pid


def check_error_dialog(pid: int) -> tuple[bool, str]:
    if sys.platform != "win32":
        return False, ""
    
    import ctypes
    from ctypes import wintypes
    
    user32 = ctypes.windll.user32
    error_found = False
    reason = ""
    
    def enum_windows_proc(hwnd, lParam):
        nonlocal error_found, reason
        win_pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(win_pid))
        if win_pid.value == pid:
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                buff = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buff, length + 1)
                title = buff.value.lower()
                
                class_buff = ctypes.create_unicode_buffer(256)
                user32.GetClassNameW(hwnd, class_buff, 256)
                class_name = class_buff.value
                
                # Check for standard dialog box or error keywords in title
                if class_name == "#32770" or any(k in title for k in ["error", "exception", "fail", "fatal", "missing", "message"]):
                    error_found = True
                    reason = f"Class '{class_name}', Title '{buff.value}'"
                    return False # stop enum
        return True
        
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(EnumWindowsProc(enum_windows_proc), 0)
    return error_found, reason
