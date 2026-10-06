from __future__ import annotations
from digital_backup import DigitalArchiveBackup
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from digital_storage import DigitalGameStorage
import logging
from logging.handlers import RotatingFileHandler

os.makedirs("logs", exist_ok=True)
logger = logging.getLogger("DigitalExecution")
logger.setLevel(logging.INFO)
if not logger.handlers:
    fh = RotatingFileHandler("logs/execution.log", maxBytes=1024*1024, backupCount=0, encoding="utf-8")
    fh.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(fh)


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

class DigitalProcessRunner:
    def __init__(self, storage=None):
        self.storage = storage or DigitalGameStorage()

    def rank_executable(self, exe_path: Path, game_name: str) -> float:
        score = 0.0
        exe_name = exe_path.stem.lower()
        g_name = game_name.lower()
        
        if exe_name in g_name or g_name in exe_name:
            score += 10.0
            
        g_words = re.findall(r'\w+', g_name)
        for w in g_words:
            if len(w) > 2 and w in exe_name:
                score += 5.0
                
        if len(exe_path.parents) >= 2 and exe_path.parent == exe_path.parents[-2]:
            score += 2.0
            
        return score

    def get_candidates(self, folder: Path, name: str, command: str) -> list[tuple[Path, list[str]]]:
        logger.info(f"Resolviendo ejecutable para carpeta: '{folder}', nombre: '{name}'")
        
        if command.strip():
            if re.search(r"[&|<>\r\n]|steam:", command, re.I):
                raise ValueError("Comando rechazado: contiene caracteres prohibidos.")
            parts = shlex.split(command, posix=False)
            candidate = folder / parts[0].strip('"')
            executable = candidate.resolve()
            arguments = [p.strip('"') for p in parts[1:]]
            if executable.is_relative_to(folder) and executable.is_file():
                logger.info(f"Candidato desde playProcess explicito: {executable}")
                return [(executable, arguments)]
                
        play_bat = folder / "play.bat"
        if play_bat.is_file():
            logger.info("Encontrado play.bat en la carpeta, usandolo como candidato principal.")
            return [(play_bat, [])]
            
        logger.info("Iniciando descubrimiento heuristico de ejecutables...")
        all_exes = list(folder.rglob("*.exe"))
        
        blacklist = r"setup|install|unins|redist|crash|report|helper|unitycrash|vc_redist|wdapp|dump_client|dxsetup|prereq"
        candidates = [p for p in all_exes if not re.search(blacklist, str(p.relative_to(folder)), re.I)]
        
        if not candidates:
            raise ValueError("No se encontraron ejecutables validos en la carpeta.")
            
        candidates.sort(key=lambda p: self.rank_executable(p, name), reverse=True)
        
        logger.info(f"Se probaran {len(candidates)} ejecutables en orden: {[p.name for p in candidates]}")
        return [(c.resolve(), []) for c in candidates]

    def run(self, action, app_id, name, command="", auto_installed=False):
        result = {"ok": False, "action": action, "app_id": app_id, "name": name, "command": command}
        try:
            if action == "snapshot":
                games = json.loads(command)
                return {"ok": True, "statuses": {str(g["id"]): self.storage.status(g["id"], g["name"]) for g in games}}
            folder = self.storage.folder(app_id, name)
            result["folder"] = str(folder)
            if action == "status":
                backup = None if auto_installed else DigitalArchiveBackup.info(folder, name)
                return {**result, "ok": True, **self.storage.status(app_id, name),
                        "backup_requires_password": bool(not auto_installed and backup and backup["needs_password"])}
            if action == "uninstall":
                self.storage.uninstall(app_id, name)
                return {**result, "ok": True, "exit_code": 0}
            if action == "open-folder":
                if not folder.is_dir():
                    raise ValueError("No existe la carpeta descargada.")
                os.startfile(str(folder))
                return {**result, "ok": True}
            if action != "play":
                raise ValueError(f"Unknown action '{action}'")
                
            if not auto_installed:
                DigitalArchiveBackup.restore(folder, name, app_id, self.storage.launcher)
            if not self.storage.status(app_id, name)["installed"]:
                raise ValueError("El juego no esta descargado y descomprimido en su carpeta Digital.")
                
            candidates = self.get_candidates(folder, name, command)
            flags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000008 if sys.platform == "win32" else 0
            
            last_error = None
            for executable, arguments in candidates:
                logger.info(f"Intentando ejecutar: {executable} {arguments}")
                try:
                    if executable.suffix.lower() == ".bat":
                        process = subprocess.Popen(["cmd.exe", "/c", str(executable)], cwd=str(executable.parent), creationflags=flags, close_fds=True)
                    else:
                        process = subprocess.Popen([str(executable), *arguments], cwd=str(executable.parent), creationflags=flags, close_fds=True)
                    
                    try:
                        # Wait a bit longer to allow dialogs to pop up
                        process.wait(timeout=3.5)
                        if process.returncode != 0:
                            logger.warning(f"Ejecutable fallo rapido con codigo {process.returncode}: {executable}")
                            last_error = f"El proceso cerro con codigo {process.returncode}"
                            continue
                    except subprocess.TimeoutExpired:
                        is_err, err_msg = check_error_dialog(process.pid)
                        if is_err:
                            logger.warning(f"Se detecto un dialogo de error ({err_msg}). Matando proceso y descartando: {executable}")
                            try:
                                process.kill()
                            except Exception:
                                pass
                            last_error = f"Mostro dialogo de error: {err_msg}"
                            continue
                            
                    logger.info(f"Ejecucion exitosa confirmada: {executable}")
                    
                    if executable.suffix.lower() != ".bat" and not command.strip():
                        play_bat = folder / "play.bat"
                        if not play_bat.exists():
                            rel_path = executable.relative_to(folder)
                            with open(play_bat, "w", encoding="utf-8") as f:
                                f.write(f'@echo off\nstart "" "{rel_path}"\nexit\n')
                            logger.info("Creado play.bat con la ruta exitosa para futuros lanzamientos.")
                            
                    return {**result, "ok": True, "pid": process.pid, "command": str(executable)}
                except Exception as e:
                    logger.warning(f"Excepcion al intentar {executable}: {e}")
                    last_error = str(e)
                    continue
                    
            raise ValueError(f"Ningun ejecutable candidato funciono. Ultimo error: {last_error}")

        except Exception as error:
            logger.error(f"Error general en run(): {error}")
            return {**result, "error": str(error)}

def run_process(action, app_id, name, command="", working_dir=None, auto_installed=False):
    return DigitalProcessRunner().run(action, app_id, name, command, auto_installed)

def main():
    parser = argparse.ArgumentParser(description="Digital folder lifecycle")
    parser.add_argument("--action", choices=["play", "uninstall", "status", "snapshot", "open-folder"], required=True)
    parser.add_argument("--app-id", type=int, required=True)
    parser.add_argument("--name", default="")
    parser.add_argument("--command", default="")
    parser.add_argument("--auto-installed", action="store_true")
    parser.add_argument("--working-dir", default=None)
    args = parser.parse_args()
    payload = sys.stdin.read() if args.action == "snapshot" and not args.command else args.command
    result = run_process(args.action, args.app_id, args.name, payload, auto_installed=args.auto_installed)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1

if __name__ == "__main__":
    sys.exit(main())
