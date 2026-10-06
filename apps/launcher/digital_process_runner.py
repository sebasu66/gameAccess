from __future__ import annotations
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

# Setup logger for execution matching downloader logs
os.makedirs("logs", exist_ok=True)
logger = logging.getLogger("DigitalExecution")
logger.setLevel(logging.INFO)
if not logger.handlers:
    fh = RotatingFileHandler("logs/downloads.log", maxBytes=1024*1024, backupCount=0, encoding="utf-8")
    fh.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(fh)

class DigitalProcessRunner:
    def __init__(self, storage=None):
        self.storage = storage or DigitalGameStorage()

    def executable(self, folder, command):
        logger.info(f"Resolviendo ejecutable para carpeta: '{folder}' con comando inicial: '{command}'")
        arguments = []
        if command.strip():
            if re.search(r"[&|;<>\r\n]|steam:", command, re.I):
                logger.error("Comando rechazado: contiene caracteres prohibidos o protocolos Steam.")
                raise ValueError("Digital requiere un ejecutable local; no admite comandos de Steam ni scripts de instalación.")
            parts = shlex.split(command, posix=False)
            candidate = folder / parts[0].strip('"')
            executable = candidate.resolve()
            arguments = [p.strip('"') for p in parts[1:]]
            if not executable.is_relative_to(folder) or not executable.is_file():
                logger.error(f"Ejecutable no válido o fuera de ruta: {executable}")
                raise ValueError("El ejecutable configurado no se encuentra en la carpeta descargada.")
            logger.info(f"Ejecutable resuelto vía playProcess directo: {executable} (args: {arguments})")
        else:
            logger.info("No hay playProcess definido. Iniciando escaneo heurístico de ejecutables...")
            all_exes = list(folder.rglob("*.exe"))
            logger.info(f"Se encontraron {len(all_exes)} ejecutables en total.")
            candidates = [p for p in all_exes if not re.search(
                r"setup|install|unins|redist|crash|report|helper|unitycrash|vc_redist|wdapp", str(p.relative_to(folder)), re.I)]
            logger.info(f"Después de filtrar instaladores/redistribuibles, quedan {len(candidates)} candidatos.")
            
            root_candidates = [p for p in candidates if p.parent == folder]
            if len(root_candidates) == 1:
                logger.info(f"Se priorizó {root_candidates[0]} por estar en la raíz exclusiva.")
                candidates = root_candidates
                
            if len(candidates) != 1:
                logger.error(f"Heurística fallida. Múltiples ejecutables: {[p.name for p in candidates]}")
                raise ValueError("No se pudo identificar un único ejecutable del juego en la carpeta descargada. Configure playProcess con su ruta relativa.")
            executable = candidates[0].resolve()
            logger.info(f"Ejecutable resuelto por heurística: {executable}")
            
        if not executable.is_relative_to(folder):
            raise ValueError("El ejecutable debe permanecer dentro de la carpeta Digital.")
        return executable, arguments

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
                raise ValueError("El juego no está descargado y descomprimido en su carpeta Digital.")
            executable, arguments = self.executable(folder, command)
            flags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000008 if sys.platform == "win32" else 0
            process = subprocess.Popen([str(executable), *arguments], cwd=str(executable.parent),
                creationflags=flags, close_fds=True)
            return {**result, "ok": True, "pid": process.pid, "command": str(executable)}
        except Exception as error:
            return {**result, "error": str(error)}

def run_process(action, app_id, name, command="", working_dir=None, auto_installed=False):
    # working_dir cannot redirect Digital execution away from its registered folder.
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
