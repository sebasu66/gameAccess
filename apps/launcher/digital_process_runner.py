from __future__ import annotations
from game_execution_manager.fix_backup import DigitalArchiveBackup
from game_execution_manager.execution_profile import load_profile, apply_before_play
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from game_library_manager.storage import DigitalGameStorage
from game_library_manager.freeze_control import FreezeCancelled, holder as freeze_holder
import game_journal as journal
import game_execution_manager as gem
from game_library_manager import GameLibraryManager
from game_library_manager.linked import run_linked
from game_library_manager.freezer import GameFreezer
from game_library_manager.preferences import DigitalPreferences
from game_paths import root_warning
from steam_account_manager import SteamAccountManager
from game_execution_manager.game_options import DigitalGameOptions, effective_language, repair_language
from game_execution_manager.onlinefix_flag import OnlineFixFlag
from game_execution_manager.launch import checked_executable, parse_arguments, launch_as_administrator, check_error_dialog, short_path
from game_download_manager.unpack import extractor_for, restorer_for
import logging
from flow_diagnostics import FlowDiagnostics

import app_log
logger = app_log.configure()


class DigitalProcessRunner:
    def __init__(self, storage=None):
        self.storage = storage or DigitalGameStorage()

    def rank_executable(self, exe_path: Path, game_name: str) -> float:
        return gem.rank_executable(exe_path, game_name)

    def get_candidates(self, folder: Path, name: str, command: str, patterns=()) -> list[tuple[Path, list[str]]]:
        logger.info(f"Resolviendo ejecutable para carpeta: '{folder}', nombre: '{name}'")
        return gem.find_candidates(folder, name, command, patterns, logger)

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
            if action in ("settings", "save-settings"):
                preferences = DigitalPreferences(self.storage.launcher)
                settings = preferences.save(json.loads(command)) if action == "save-settings" else preferences.load()
                # A long games folder, or one with accents or symbols, can keep games from running: the app says so.
                return {**result, "ok": True, "settings": settings, "games_root_warning": root_warning(settings["games_root"])}
            if action == "local-games":
                return {**result, "ok": True, "games": self.storage.local_games()}
            if action == "snapshot":
                games = json.loads(command)
                return {"ok": True, "statuses": self.storage.snapshot(games)}
            if action.startswith("steam-"):
                steam = SteamAccountManager(self.storage.launcher)
                request = json.loads(command or "{}")
                if action == "steam-status":
                    return {**result, "ok": True, "steam": steam.status()}
                if action == "steam-save-settings":
                    return {**result, "ok": True, "settings": steam.save_settings(request)}
                if action == "steam-sync":
                    if request.get("auto") and not steam.settings()["auto_import"]:
                        return {**result, "ok": True, "skipped": True, "linked": [], "owned": []}
                    library = GameLibraryManager(self.storage, steam=steam)
                    return {**result, "ok": True, **library.steam_sync(bool(request.get("refresh")), str(request.get("api") or ""))}
                if action == "steam-install":
                    self.storage.linked.unhide(app_id)
                    return {**result, "ok": True, **steam.install(app_id)}
                raise ValueError(f"Unknown action '{action}'")
            if action.startswith(("library-", "import-")):
                library = GameLibraryManager(self.storage, gem.GameExecutionManager(self.storage, extractor=extractor_for(self.storage.launcher, app_id), logger=logger),
                                             steam=SteamAccountManager(self.storage.launcher))
                if action == "library-list":
                    games, transfers = library.list_games(), library.transfers()
                    return {**result, "ok": True, "library": games, "transfers": transfers, "usage": library.usage(), "summary": library.summary(games, transfers)}
                if action == "library-plan":
                    return {**result, "ok": True, "plans": library.plan(json.loads(command)["app_ids"])}
                if action == "library-space":
                    request = json.loads(command or "{}")
                    return {**result, "ok": True, "space": library.check_space(int(request.get("bytes", 0)), int(request.get("app_id") or 0),
                                                                                  str(request.get("name") or ""))}
                if action == "library-relocate-plan":
                    return {**result, "ok": True, "plan": library.relocate_plan(json.loads(command)["target"])}
                if action == "library-relocate":
                    request = json.loads(command)
                    return {**result, "ok": True, "relocated": library.relocate(int(request["app_id"]), request["target"], request.get("mode", "move"))}
                if action == "library-relocate-finish":
                    return {**result, **library.relocate_finish()}
                if action == "library-batch":
                    request = json.loads(command)
                    return {**result, "ok": True, "results": library.batch(request["action"], request["app_ids"])}
                if action == "import-drives":
                    return {**result, "ok": True, "drives": library.import_drives()}
                if action == "import-scan":
                    request = json.loads(command or "{}")
                    return {**result, "ok": True, "candidates": library.import_scan(request.get("drives", []), folders=request.get("folders", []))}
                if action == "import-run":
                    return {**result, "ok": True, "results": library.import_games(json.loads(command)["items"])}
                if action == "library-autofreeze":
                    request = json.loads(command or "{}")
                    return {**result, "ok": True, "results": library.freezer.auto(int(request.get("freeze_days", 30)), int(request.get("deep_days", 90)))}
                raise ValueError(f"Unknown action '{action}'")
            if action == "probe-source":
                from game_download_manager.source_probe import probe_source
                return {**result, "ok": True, "probe": probe_source(command)}
            if action == "set-label":
                return {**result, "ok": True, "label": self.storage.set_label(app_id, name, command)}
            freezer = GameFreezer(self.storage, logger)
            if action == "freeze-recover":
                return {**result, "ok": True, "recovered": freezer.recover()}
            if action in ("freeze", "deep-freeze", "thaw"):
                try:
                    if action == "thaw":
                        return {**result, "ok": True, **freezer.thaw(app_id, name)}
                    return {**result, "ok": True, "frozen": (freezer.deep_freeze if action == "deep-freeze" else freezer.freeze)(app_id, name)}
                except FreezeCancelled as cancelled:
                    return {**result, "ok": True, "cancelled": True, "message": str(cancelled)}
            # While a game is being frozen or thawed, nothing else touches it (play, uninstall, repair...).
            owner = freeze_holder(freezer.records)
            if owner and int(owner.get("app_id", -1)) == int(app_id) and action not in ("status", "snapshot", "game-log", "open-folder", "game-options"):
                raise ValueError("Se está congelando o descongelando este juego: esperá a que termine o cancelalo.")
            linked_record = self.storage.linked.get(app_id)
            if linked_record:
                # A linked game stays where it is: only launched/tracked, never modified (no fix re-apply, no journal inside it).
                outcome = run_linked(action, linked_record, self.storage.linked, logger,
                                     lambda game_folder, game_name: gem.find_candidates(game_folder, game_name, "", [], logger),
                                     SteamAccountManager(self.storage.launcher) if linked_record["kind"] == "steam" else None)
                return {**result, "ok": True, "folder": linked_record["path"], **outcome}
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
            if action in ("repair-language", "game-analyze", "game-repair", "install-setup") and freezer.ensure_thawed(app_id, name):
                logger.info("AppID %s: thawed from deep freeze before %s", app_id, action)
            if action == "repair-language":
                options = game_options.load(app_id)
                repaired = repair_language(folder, effective_language(options), logger)
                return {**result, "ok": True, **repaired}
            if action == "status":
                backup = None if auto_installed else DigitalArchiveBackup.info(folder, name)
                return {**result, "ok": True, **self.storage.status(app_id, name),
                        "backup_requires_password": bool(not auto_installed and backup and backup["needs_password"])}
            if action == "uninstall":
                logger.info("AppID %s: uninstall starting; validated folder=%s; removes partial files without installation or executable checks", app_id, folder)
                self.storage.uninstall(app_id, name)
                freezer.forget(app_id)
                logger.info("AppID %s: uninstall finished; folder and local registry/download records removed", app_id)
                return {**result, "ok": True, "exit_code": 0}
            if action == "game-log":
                # The game's own steps and, when its installer ran, the end of that installer's log (why it stopped).
                from game_execution_manager.setup_installer import LOG_FILE
                installer = folder / LOG_FILE
                tail = installer.read_text(encoding="utf-8", errors="replace").splitlines()[-40:] if installer.is_file() else []
                return {**result, "ok": True, "log": journal.read(folder), "installer_log": "\n".join(tail)}
            if action in ("game-analyze", "game-repair"):
                manager = gem.GameExecutionManager(self.storage, extractor=extractor_for(self.storage.launcher, app_id), logger=logger)
                if action == "game-analyze":
                    return {**result, "ok": True, "analysis": manager.analyze(app_id, name)}
                return {**result, **manager.repair(app_id, name)}
            if action == "install-setup":
                from game_execution_manager.setup_installer import install_if_needed
                ran = install_if_needed(folder, load_profile(self.storage.launcher, app_id), logger)
                return {**result, "ok": True, "setup_ran": ran}
            if action == "open-folder":
                if command == "download":
                    # While it downloads (or after it stopped) the files are in the temporary download folder.
                    transfer = next((Path(item["folder"]) for item in self.storage.transfers() if item["app_id"] == app_id), None)
                    if transfer is not None and transfer.is_dir():
                        folder = transfer
                if not folder.is_dir():
                    raise ValueError("No existe la carpeta descargada.")
                os.startfile(str(folder))
                return {**result, "ok": True}
            if action != "play":
                raise ValueError(f"Unknown action '{action}'")
                
            logger.info("AppID %s: Play requested; folder=%s; auto_installed=%s", app_id, folder, auto_installed)
            journal.note(folder, "play", "solicitado")
            if freezer.ensure_thawed(app_id, name):  # a deep-frozen game comes back before anything reads its files
                logger.info("AppID %s: thawed from deep freeze before play", app_id)
            saved_options = DigitalGameOptions(self.storage).load(app_id)
            profile = load_profile(self.storage.launcher, app_id)
            # Either switch can turn the re-apply off; the file the user picks in the form beats the declared one.
            declared = profile.get("decompressFile", "")
            reapply = saved_options["backupEnabled"] and (profile["decompressEachRun"] if declared else True)
            fix_archive = saved_options["backupArchive"] or (declared if (declared and (folder / declared).is_file()) else "")
            onlinefix = OnlineFixFlag(self.storage.data / ".cache" / "digital_launch" / f"{int(app_id)}-onlinefix.json", logger)
            onlinefix.learn(folder)
            if not auto_installed and reapply:
                logger.info("AppID %s: re-applying the fix archive before executable discovery; archive=%s",
                            app_id, fix_archive or "automatic")
                DigitalArchiveBackup.restore(folder, name, app_id, self.storage.launcher, fix_archive, restorer_for(self.storage.launcher, app_id))
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
            self.patch_crack_language(folder, effective_language(options))
            onlinefix.restore(folder)
                
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
                    # A long path is started through its short form (Windows refuses a working folder past 260 characters).
                    run_file, run_dir = short_path(executable), short_path(executable.parent)
                    if executable.suffix.lower() == ".bat":
                        process = subprocess.Popen(["cmd.exe", "/c", run_file, *arguments], cwd=run_dir, creationflags=flags, close_fds=True)
                    else:
                        process = subprocess.Popen([run_file, *arguments], cwd=run_dir, creationflags=flags, close_fds=True)
                    
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
    parser.add_argument("--action", choices=["play", "uninstall", "status", "snapshot", "open-folder", "settings", "save-settings", "local-games", "game-options", "save-game-options", "repair-language", "install-setup", "game-log", "game-analyze", "game-repair", "library-list", "library-plan", "library-space", "library-batch", "library-relocate-plan", "library-relocate", "library-relocate-finish", "library-autofreeze", "import-drives", "import-scan", "import-run", "set-label", "probe-source", "freeze", "deep-freeze", "thaw", "freeze-recover", "steam-status", "steam-save-settings", "steam-sync", "steam-install"], required=True)
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
