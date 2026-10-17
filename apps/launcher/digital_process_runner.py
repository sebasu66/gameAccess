from __future__ import annotations
from digital_backup import DigitalArchiveBackup
from execution_profile import load_profile, apply_before_play, executable_matches
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from digital_storage import DigitalGameStorage
import game_journal as journal
import game_execution_manager as gem
from digital_preferences import DigitalPreferences
from digital_game_options import DigitalGameOptions, checked_executable, parse_arguments, repair_language, launch_as_administrator
import logging
from flow_diagnostics import FlowDiagnostics
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
        return gem.rank_executable(exe_path, game_name)

    def get_candidates(self, folder: Path, name: str, command: str, patterns=()) -> list[tuple[Path, list[str]]]:
        logger.info(f"Resolviendo ejecutable para carpeta: '{folder}', nombre: '{name}'")
        return gem.find_candidates(folder, name, command, patterns, logger)

    def extract_in_place(self, folder: Path, archive: Path):
        """Unpack one leftover archive into the game folder with the download worker's extractor."""
        import io, contextlib
        import digital_downloader as worker
        worker.LAUNCHER_DIR = Path(self.storage.launcher)
        worker.g_cancelled.clear()
        original_emit = worker.emit_json
        try:
            worker.emit_json = lambda *_a, **_k: None
            with contextlib.redirect_stdout(io.StringIO()):
                worker.extract_archives_in_path(str(archive), str(folder), delete_archive=True, retain_backup=True)
        finally:
            worker.emit_json = original_emit

    def repair(self, manager, app_id, name) -> dict:
        """The 'wizard': installing while it works, ready when a runnable executable exists, ERROR (in the log) otherwise."""
        self.storage.set_status(app_id, name, "installing")
        try:
            analysis = manager.prepare(app_id, name)
        except gem.GameExecutionError as error:
            self.storage.write_error(app_id, name, str(error))
            return {"ok": False, "error": str(error), "file": error.file}
        self.storage.set_status(app_id, name, "ready")
        journal.note(self.storage.folder(app_id, name), "reparación", f"listo; ejecutable {analysis['executable']}")
        return {"ok": True, "analysis": analysis}

    def patch_crack_language(self, folder: Path, language="spanish"):
        # Keep the established automatic preparation, honoring the user's choice.
        return repair_language(folder, language, logger, known_only=True)

    def run(self, action, app_id, name, command="", auto_installed=False):
        diagnostics = FlowDiagnostics(logger, action, app_id)
        diagnostics.debug("Operation entered; auto_installed=%s", auto_installed)
        # Per invocation, not shared instance state: concurrent calls remain separate.
        try:
            result = self._run(action, app_id, name, command, auto_installed, diagnostics)
            if result.get("ok"):
                diagnostics.succeed()
            else:
                diagnostics.fail(result.get("error", "Operation failed"))
            return result
        except Exception as error:
            diagnostics.fail(error)
            raise
        finally:
            diagnostics.discard()

    def _run(self, action, app_id, name, command, auto_installed, diagnostics):
        result = {"ok": False, "action": action, "app_id": app_id, "name": name, "command": command}
        try:
            if action == "settings":
                return {**result, "ok": True, "settings": DigitalPreferences(self.storage.launcher).load()}
            if action == "save-settings":
                values = json.loads(command)
                return {**result, "ok": True, "settings": DigitalPreferences(self.storage.launcher).save(values)}
            if action == "local-games":
                return {**result, "ok": True, "games": self.storage.local_games()}
            if action == "snapshot":
                games = json.loads(command)
                return {"ok": True, "statuses": self.storage.snapshot(games)}
            folder = self.storage.folder(app_id, name)
            result["folder"] = str(folder)
            diagnostics.debug("Resolved app folder=%s", folder)
            game_options = DigitalGameOptions(self.storage)
            if action == "game-options":
                return {**result, "ok": True, **game_options.inspect(app_id, name)}
            if action == "save-game-options":
                options = game_options.save(app_id, name, json.loads(command))
                logger.info("AppID %s: launch options saved; executable=%s; administrator=%s; language=%s", app_id, options["executable"] or "automatic", options["administrator"], options["language"])
                return {**result, "ok": True, "options": options}
            if action == "repair-language":
                options = game_options.load(app_id)
                repaired = repair_language(folder, options["language"], logger)
                return {**result, "ok": True, **repaired}
            if action == "status":
                backup = None if auto_installed else DigitalArchiveBackup.info(folder, name)
                return {**result, "ok": True, **self.storage.status(app_id, name),
                        "backup_requires_password": bool(not auto_installed and backup and backup["needs_password"])}
            if action == "uninstall":
                logger.info("AppID %s: uninstall starting; validated folder=%s; removes partial files without installation or executable checks", app_id, folder)
                self.storage.uninstall(app_id, name)
                logger.info("AppID %s: uninstall finished; folder and local registry/download records removed", app_id)
                return {**result, "ok": True, "exit_code": 0}
            if action == "game-log":
                return {**result, "ok": True, "log": journal.read(folder)}
            if action in ("game-analyze", "game-repair"):
                manager = gem.GameExecutionManager(self.storage, extractor=self.extract_in_place, logger=logger)
                if action == "game-analyze":
                    return {**result, "ok": True, "analysis": manager.analyze(app_id, name)}
                return {**result, **self.repair(manager, app_id, name)}
            if action == "install-setup":
                from setup_installer import install_if_needed
                ran = install_if_needed(folder, load_profile(self.storage.launcher, app_id), logger)
                return {**result, "ok": True, "setup_ran": ran}
            if action == "open-folder":
                if not folder.is_dir():
                    raise ValueError("No existe la carpeta descargada.")
                os.startfile(str(folder))
                return {**result, "ok": True}
            if action != "play":
                raise ValueError(f"Unknown action '{action}'")
                
            logger.info("AppID %s: Play requested; folder=%s; auto_installed=%s", app_id, folder, auto_installed)
            journal.note(folder, "play", "solicitado")
            saved_options = DigitalGameOptions(self.storage).load(app_id)
            profile = load_profile(self.storage.launcher, app_id)
            # Either switch can turn the re-apply off; the file the user picks in the form beats the declared one.
            declared = profile.get("decompressFile", "")
            reapply = saved_options["backupEnabled"] and (profile["decompressEachRun"] if declared else True)
            fix_archive = saved_options["backupArchive"] or (declared if (declared and (folder / declared).is_file()) else "")
            if not auto_installed and reapply:
                logger.info("AppID %s: re-applying the fix archive before executable discovery; archive=%s",
                            app_id, fix_archive or "automatic")
                DigitalArchiveBackup.restore(folder, name, app_id, self.storage.launcher, fix_archive)
                journal.note(folder, "play", f"fix reaplicado: {fix_archive or 'respaldo automático'}")
            elif not reapply:
                logger.info("AppID %s: fix re-apply disabled in the execution profile/options", app_id)
            if not self.storage.status(app_id, name)["installed"]:
                raise ValueError("El juego no esta descargado y descomprimido en su carpeta Digital.")
                
            # Apply optional local profile before executable discovery.
            logger.info("AppID %s: applying optional execution profile; steps=%s", app_id, len(profile["beforePlay"]))
            diagnostics.debug("Execution profile loaded; preparation_steps=%s", len(profile["beforePlay"]))
            apply_before_play(folder, profile)
            diagnostics.debug("Before-play preparation finished")
            options = game_options.load(app_id)
            self.patch_crack_language(folder, options["language"])
                
            logger.info("AppID %s: folder payload validated; existing launch preparation finished", app_id)
            if options["executable"]:
                candidates = [(checked_executable(folder, options["executable"]), parse_arguments(options["arguments"]))]
            else:
                candidates = self.get_candidates(folder, name, command, profile.get("executablePatterns", []))
                extra = parse_arguments(options["arguments"])
                candidates = [(exe, [*arguments, *extra]) for exe, arguments in candidates]
            administrator = options["administrator"] or profile.get("runAsAdmin", False)
            diagnostics.debug("Candidates=%s administrator=%s", [str(exe) for exe, _ in candidates], administrator)
            if administrator:
                executable, arguments = candidates[0]
                if executable.suffix.lower() != ".exe":
                    raise ValueError("Selecciona el archivo .exe del juego para ejecutar como administrador.")
                pid = launch_as_administrator(executable, arguments, executable.parent)
                journal.note(folder, "play", f"lanzado como administrador: {executable.relative_to(folder)} (pid {pid})")
                logger.info("AppID %s: Windows accepted administrator launch; pid=%s; executable=%s", app_id, pid, executable)
                return {**result, "ok": True, "pid": pid, "command": str(executable), "administrator": True}
            flags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000008 if sys.platform == "win32" else 0
            
            last_error = None
            for executable, arguments in candidates:
                logger.info(f"Intentando ejecutar: {executable} {arguments}")
                try:
                    diagnostics.debug("Starting candidate=%s cwd=%s", executable, executable.parent)
                    if executable.suffix.lower() == ".bat":
                        process = subprocess.Popen(["cmd.exe", "/c", str(executable), *arguments], cwd=str(executable.parent), creationflags=flags, close_fds=True)
                    else:
                        process = subprocess.Popen([str(executable), *arguments], cwd=str(executable.parent), creationflags=flags, close_fds=True)
                    
                    try:
                        # Wait a bit longer to allow dialogs to pop up
                        process.wait(timeout=3.5)
                        if process.returncode != 0:
                            logger.warning(f"Ejecutable fallo rapido con codigo {process.returncode}: {executable}")
                            last_error = f"El proceso cerro con codigo {process.returncode}"
                            journal.note(folder, "play", f"{executable.name} falló al arrancar: código {process.returncode}")
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
                            journal.note(folder, "play", f"{executable.name} mostró un diálogo de error ({err_msg}); se descarta")
                            continue
                            
                    logger.info("AppID %s: launch accepted; pid=%s; executable=%s; cwd=%s", app_id, process.pid, executable, executable.parent)
                    journal.note(folder, "play", f"lanzado: {executable.relative_to(folder)} (pid {process.pid})")
                    logger.info(f"Ejecucion exitosa confirmada: {executable}")
                    
                    if executable.suffix.lower() != ".bat" and not command.strip():
                        play_bat = folder / "play.bat"
                        exe_marker = folder / ".gameaccess_exe"
                        
                        try:
                            rel_path = executable.relative_to(folder)
                            if not exe_marker.exists():
                                exe_marker.write_text(str(rel_path), encoding="utf-8")
                                
                            if not play_bat.exists():
                                rel_dir = executable.parent.relative_to(folder)
                                exe_name = executable.name
                                cd_cmd = f'cd /d "%~dp0{rel_dir}"' if str(rel_dir) != "." else 'cd /d "%~dp0"'
                                with open(play_bat, "w", encoding="utf-8") as f:
                                    f.write(f'@echo off\n{cd_cmd}\n"{exe_name}"\n')
                                logger.info("Creado marcador .gameaccess_exe y play.bat para futuros lanzamientos.")
                        except Exception as e:
                            logger.error(f"Error guardando marcador de exe: {e}")
                            
                    return {**result, "ok": True, "pid": process.pid, "command": str(executable)}
                except Exception as e:
                    logger.warning(f"Excepcion al intentar {executable}: {e}")
                    diagnostics.debug("Candidate failed: %s", e)
                    last_error = str(e)
                    continue
                    
            raise ValueError(f"Ningun ejecutable candidato funciono. Ultimo error: {last_error}")

        except Exception as error:
            logger.error(f"Error general en run(): {error}")
            if action == "play" and "folder" in locals():
                journal.note(folder, "play", f"error: {error}")
            return {**result, "error": str(error)}

def run_process(action, app_id, name, command="", working_dir=None, auto_installed=False):
    return DigitalProcessRunner().run(action, app_id, name, command, auto_installed)

def main():
    parser = argparse.ArgumentParser(description="Digital folder lifecycle")
    parser.add_argument("--action", choices=["play", "uninstall", "status", "snapshot", "open-folder", "settings", "save-settings", "local-games", "game-options", "save-game-options", "repair-language", "install-setup", "game-log", "game-analyze", "game-repair"], required=True)
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
