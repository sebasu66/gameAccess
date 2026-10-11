"""Desktop links launch GameAccess with a game ID, never the game's executable."""
import argparse
import ctypes
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

log = logging.getLogger("DigitalExecution")

def desktop_directory() -> Path:
    if os.name != "nt":
        raise RuntimeError("Los accesos directos de escritorio requieren Windows.")
    from ctypes import wintypes
    class GUID(ctypes.Structure):
        _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]
    guid = GUID.from_buffer_copy(uuid.UUID("B4BFCC3A-DB2C-424C-B029-7FE99A87C641").bytes_le)
    result = ctypes.c_wchar_p()
    shell = ctypes.windll.shell32.SHGetKnownFolderPath
    shell.argtypes = [ctypes.POINTER(GUID), wintypes.DWORD, wintypes.HANDLE, ctypes.POINTER(ctypes.c_wchar_p)]
    shell.restype = ctypes.c_long
    code = shell(ctypes.byref(guid), 0, None, ctypes.byref(result))
    if code != 0:
        raise RuntimeError("No se pudo encontrar el escritorio de Windows.")
    try:
        return Path(result.value)
    finally:
        ctypes.windll.ole32.CoTaskMemFree(ctypes.cast(result, ctypes.c_void_p))

def shortcut_name(app_id: int, name: str) -> str:
    if not 0 < app_id <= 0xFFFFFFFF:
        raise ValueError("AppID inválido.")
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name).strip(" .")[:100] or str(app_id)
    return f"{safe} - GameAccess {app_id}.lnk"

_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($data.path)
$link.TargetPath = $data.launcher
$link.Arguments = $data.arguments
$link.WorkingDirectory = $data.directory
$link.Description = $data.description
$link.IconLocation = $data.icon
$link.Save()
"""

def create_shortcut(app_id: int, name: str, launcher: Path, desktop: Path | None = None) -> Path:
    launcher = launcher.resolve(strict=True)
    if launcher.suffix.lower() != ".exe":
        raise ValueError("El destino debe ser GameAccess.exe.")
    desktop = desktop or desktop_directory()
    desktop.mkdir(parents=True, exist_ok=True)
    path = desktop / shortcut_name(app_id, name)
    payload = {"path": str(path), "launcher": str(launcher), "arguments": f"--launch-game {app_id}",
               "directory": str(launcher.parent), "description": f"Abrir {name} con GameAccess",
               "icon": f"{launcher},0"}
    # Data is JSON on stdin; paths and names are never interpolated into shell code.
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", _SCRIPT],
                            input=json.dumps(payload), text=True, encoding="utf-8", capture_output=True,
                            timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode != 0 or not path.is_file():
        raise RuntimeError("No se pudo guardar el acceso directo de GameAccess.")
    log.info("AppID %s: acceso directo de GameAccess creado", app_id)
    return path

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-id", required=True, type=int)
    parser.add_argument("--name", required=True)
    parser.add_argument("--launcher", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps({"ok": True, "path": str(create_shortcut(args.app_id, args.name, args.launcher))}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
