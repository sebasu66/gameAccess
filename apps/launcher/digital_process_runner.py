from __future__ import annotations
from game_execution_manager.fix_backup import DigitalArchiveBackup
from game_execution_manager.execution_profile import load_profile, apply_before_play, save_profile, clean_learned_fix
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
from game_execution_manager.game_options import DigitalGameOptions, KEEP_LANGUAGE, effective_language, repair_language, restore_language, supports_language
from game_execution_manager.launch_trace import LaunchTrace, diagnose, progress_path
from game_execution_manager import requirements as needs
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

    def auto_fix(self, app_id, name, folder, linked_record, freezer, game_options, server_fix=None):
        """The alternatives the launch dialog's "fix it for me" tries before launching again, each reported as
        {id, ok, detail}: start Steam (in the background) for a game that uses it and is not running; thaw it when it is
        frozen; put the fix's backup back (the archive saved when it was installed); put the language files back and
        stop changing them. A step that fails does not stop the next ones. `server_fix`: what the server knows works for
        this game; it is applied too (and kept in the profile). Returns (steps, learned): `learned` is what the steps
        that really changed something did, the candidate to be shared if the game opens afterwards."""
        server_fix = clean_learned_fix(server_fix) or {}
        learned = {"steam": False, "launchers": [], "language": None, "runtimes": [], "fixBackup": False, "runAsAdmin": False}
        from game_execution_manager.launch_trace import steam_running
        steps: list[dict] = []

        def step(id_, action):
            try:
                ok, detail = action()
            except Exception as error:  # noqa: BLE001 - every failure is a result for the dialog
                ok, detail = False, str(error)
            logger.info("Auto fix %s: %s (%s)", id_, "ok" if ok else "failed", detail)
            steps.append({"id": id_, "ok": ok, "detail": detail})
            return ok

        game_folder = Path(linked_record["path"]) if linked_record else folder
        steam_game = bool(linked_record and linked_record.get("kind") == "steam")
        requires = self.game_requires(game_folder, app_id) if game_folder.is_dir() else needs.merge(None)
        uses_steam = steam_game or requires["steam"]

        def start_steam():
            if not uses_steam:
                return True, "not needed"
            if steam_running():
                return True, "already running"
            from steam_account_manager.client import find_steam
            import time
            root = find_steam()
            if not root or not (root / "steam.exe").is_file():
                return False, "Steam is not installed"
            subprocess.Popen([str(root / "steam.exe"), "-silent"], close_fds=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if steam_running():
                    time.sleep(6)  # it needs a few seconds to be ready for the game
                    learned["steam"] = True
                    return True, "started in the background"
                time.sleep(1)
            return False, "Steam did not start"
        def close_hung():
            from game_execution_manager.game_processes import close_all, game_folders, running_in
            steam = SteamAccountManager(self.storage.launcher) if steam_game else None
            found = running_in(game_folders(game_folder, linked_record, app_id, steam))
            if not found:
                return True, "no game process open"
            closed, failed = close_all(found)
            if failed:
                return False, "could not close: " + ", ".join(failed)
            return True, "closed: " + ", ".join(closed)
        # First: a hung game left open holds what the new launch needs.
        step("processes", close_hung)
        step("steam", start_steam)

        def start_launchers():
            from game_execution_manager import store_launchers
            needed = requires["launchers"]
            if not needed:
                return True, "none needed"
            problems, begun = [], []
            for launcher in needed:
                ok, why = store_launchers.start(launcher, logger=logger)
                (begun if ok and why != "already running" else problems if not ok else []).append(launcher)
            learned["launchers"] = sorted(begun)
            return not problems, ("not available: " + ", ".join(problems)) if problems else "launchers ready"
        step("launchers", start_launchers)

        def anticheat_service():
            from game_execution_manager import anticheat
            shipped = requires["anticheat"]
            if not shipped:
                return True, "no anti-cheat"
            notes, missing = [], []
            for key in shipped:
                now = anticheat.state(key)
                if now == "stopped":
                    ok, why = anticheat.start_service(key)
                    notes.append(f"{anticheat.ANTICHEATS[key]['name']}: {'started' if ok else 'could not start'}")
                elif now == "missing":
                    missing.append(anticheat.ANTICHEATS[key]["name"])
            if missing:
                # The game installs its anti-cheat's service the first time it runs as administrator.
                options = game_options.load(app_id)
                if not options["administrator"]:
                    game_options.save(app_id, name, {**options, "administrator": True})
                    learned["runAsAdmin"] = True
                notes.append("service missing (" + ", ".join(missing) + "): the game will run as administrator to install it")
            return True, "; ".join(notes) or "anti-cheat service running"
        step("anticheat", anticheat_service)
        if linked_record:
            return steps, clean_learned_fix(learned)

        def install_runtimes():
            from game_execution_manager.runtimes import install, missing_runtimes
            lacking = missing_runtimes(game_folder)
            if not lacking:
                return True, "nothing missing"
            results = [(item, *install(Path(item["installer"]), logger)) for item in lacking]
            learned["runtimes"] = sorted(f"{item['id']} {item['arch']}" for item, ok, _ in results if ok)
            failed = [f"{item['id']} {item['arch']}" for item, ok, _ in results if not ok]
            return not failed, ("failed: " + ", ".join(failed)) if failed else f"installed {len(results)}"
        def thaw():
            if freezer.ensure_thawed(app_id, name):
                return True, "thawed"
            return True, "not frozen"
        step("thaw", thaw)

        def restore_fix():
            info = DigitalArchiveBackup.info(folder, name)
            if not info:
                return True, "no fix backup"
            options = game_options.load(app_id)
            profile = load_profile(self.storage.launcher, app_id)
            declared = profile.get("decompressFile", "")
            archive = options["backupArchive"] or (declared if (declared and (folder / declared).is_file()) else "")
            DigitalArchiveBackup.restore(folder, name, app_id, self.storage.launcher, archive, restorer_for(self.storage.launcher, app_id))
            # Play already re-applies it every time unless that was switched off: only then did this step change anything.
            if not (options["backupEnabled"] and (profile["decompressEachRun"] if declared else True)):
                learned["fixBackup"] = True
            return True, "fix backup applied"
        step("runtimes", install_runtimes)
        step("fix", restore_fix)

        def keep_language():
            restored = restore_language(folder, logger)
            options = game_options.load(app_id)
            game_options.save(app_id, name, {**options, "language": KEEP_LANGUAGE})
            if restored:
                learned["language"] = "keep"
            return True, f"{len(restored)} file(s) restored"
        step("language", keep_language)

        def server_switches():
            if server_fix.get("runAsAdmin"):
                options = game_options.load(app_id)
                game_options.save(app_id, name, {**options, "administrator": True})
                learned["runAsAdmin"] = True
            if server_fix:
                save_profile(self.storage.launcher, app_id, {**load_profile(self.storage.launcher, app_id), "learnedFix": server_fix})
            return True, "server fix applied" if server_fix else "no server fix"
        step("server", server_switches)
        return steps, clean_learned_fix(learned)

    def game_requires(self, folder, app_id) -> dict:
        """What the game needs around it (Steam, store launchers, anti-cheat): what its profile says plus what its files
        show. Anything new is written back to the profile, so it is known from then on and a plugin or the player can add
        to it."""
        profile = load_profile(self.storage.launcher, app_id)
        declared = needs.merge(profile.get("requires"))
        found = needs.merge(declared, needs.detect(folder))
        if found != declared:
            try:
                save_profile(self.storage.launcher, app_id, {**profile, "requires": found})
            except (OSError, ValueError):
                logger.warning("AppID %s: could not keep what the game requires in its profile", app_id)
        return found

    @staticmethod
    def start_store_launchers(folder, launchers=None) -> list[str]:
        """The games that open through a store's launcher (Epic, Ubisoft Connect, EA...) get it running first. A launcher
        that is not installed or does not start is only written to the log: the game may not need it after all."""
        from game_execution_manager import store_launchers
        started = []
        for launcher in (store_launchers.needed_by(folder) if launchers is None else launchers):
            ok, why = store_launchers.start(launcher, logger=logger)
            logger.info("Launcher %s: %s (%s)", store_launchers.LAUNCHERS[launcher]["name"], "ok" if ok else "not available", why)
            if ok and why != "already running":
                started.append(launcher)
        return started

    def kid_entry(self, app_id, name, linked, chosen="") -> dict:
        """What the family file keeps of a game for a child's account (kid mode, vault/Modo niño.md). The child's Game
        Access plays it with this same library (the same play: fix, language, before-play steps), so this is only the
        folder, which the account may write and whose processes count as playing; whether the game asks to run as
        administrator (the account is then made one); and the executable found now, for the log.
        `chosen`: the folder the adult's library showed (a "<appid>-<name>-ready" one, or a linked game's); it rules
        when the games roots here do not hold the game, instead of the new folder name `storage.folder` would make up."""
        if linked:
            folder = Path(linked["path"])
            if linked["kind"] == "steam":
                return {"folder": str(folder), "executable": "", "arguments": [], "steam": True, "administrator": False}
        else:
            try:
                folder = self.storage.folder(app_id, name)
            except ValueError:
                folder = None
            if (folder is None or not folder.is_dir()) and chosen and Path(chosen).is_dir():
                folder = Path(chosen)
            if folder is None or not folder.is_dir():
                raise ValueError(f"No está la carpeta del juego ({chosen or folder}).")
        options = DigitalGameOptions(self.storage).load(app_id)
        profile = load_profile(self.storage.launcher, app_id)
        try:
            found = self.get_candidates(folder, name, "", profile.get("executablePatterns", []))
            executable = str(checked_executable(folder, options["executable"])) if options["executable"] and not linked else str(found[0][0]) if found else ""
        except Exception as error:  # frozen, or still to prepare: the play does that on the child's account
            logger.info("AppID %s: no executable for the family file yet (%s)", app_id, error)
            executable = ""
        return {"folder": str(folder), "executable": executable, "arguments": [], "steam": False,
                "administrator": bool(options["administrator"] or profile.get("runAsAdmin", False))}

    def patch_crack_language(self, folder: Path, language="spanish"):
        # Keep the established automatic preparation, honoring the user's choice.
        return repair_language(folder, language, logger, known_only=True)

    def verify_run(self, app_id, name, appear=30.0, stable=10.0, probe=None, sleep=None, clock=None):
        """Library manager: does this game run here? Plays it, waits for its process to show up and stay open, closes it
        and keeps the verdict (`checked` or `cantRun` with why). A game that is already running, being frozen or deep
        frozen is not touched (nothing is saved). `probe`, `sleep` and `clock` are injectable for the tests."""
        import time
        from game_execution_manager.game_processes import close_all, game_folders, running_in
        from game_library_manager.run_checks import CANT_RUN, CHECKED, RunChecks
        probe, sleep, clock = probe or running_in, sleep or time.sleep, clock or time.monotonic
        checks = RunChecks(self.storage.launcher)
        record = self.storage.linked.get(app_id)
        steam = SteamAccountManager(self.storage.launcher) if record and record.get("kind") == "steam" else None
        folder = Path(record["path"]) if record else self.storage.folder(app_id, name)
        holder = freeze_holder(GameFreezer(self.storage, logger).records)
        if holder and int(holder.get("app_id", -1)) == int(app_id):
            return {"ok": True, "app_id": app_id, "skipped": "freezing"}
        if GameFreezer(self.storage, logger).describe(app_id, folder, False).get("frozen") == "deep":
            return {"ok": True, "app_id": app_id, "skipped": "frozen"}
        folders = game_folders(folder, record, app_id, steam)
        if probe(folders):
            return {"ok": True, "app_id": app_id, "skipped": "running"}
        started = clock()
        seen: dict[int, dict] = {}

        def verdict(state, detail, problems=None):
            return {"ok": True, "app_id": app_id, "check": checks.save(app_id, state, detail, clock() - started, problems)}

        played = self.run("play", app_id, name, "", False)
        if not played.get("ok"):
            return verdict(CANT_RUN, played.get("error") or "did not start")
        try:
            first = None
            last_alive = None
            while clock() - started < appear + stable + 10:
                now = probe(folders)
                for item in now:
                    seen[int(item["pid"])] = item
                if now:
                    first = first if first is not None else clock()
                    last_alive = clock()
                    if clock() - first >= stable:
                        return verdict(CHECKED, "stayed open " + str(int(clock() - first)) + " s")
                elif first is not None:
                    return verdict(CANT_RUN, "it closed by itself after " + str(int(clock() - first)) + " s")
                elif clock() - started > appear:
                    return verdict(CANT_RUN, "no game process appeared in " + str(int(appear)) + " s")
                sleep(1.0)
            return verdict(CANT_RUN, "it did not stay open")
        finally:
            # The test run leaves nothing behind: everything seen (and what is still running from the folders) is closed.
            for item in probe(folders):
                seen[int(item["pid"])] = item
            if seen:
                close_all(list(seen.values()))

    def run(self, action, app_id, name, command="", auto_installed=False):
        if action == "verify-run":
            return self.verify_run(app_id, name)
        diagnostics = FlowDiagnostics(logger, action, app_id)
        diagnostics.debug("Operation entered; auto_installed=%s", auto_installed)
        # Per invocation, not shared instance state: concurrent calls remain separate.
        try:
            if action == "play":
                # The launch dialog reads this trace live (launch_trace.py).
                with LaunchTrace(progress_path(self.storage.launcher, app_id), logger) as trace:
                    try:
                        result = self._run(action, app_id, name, command, auto_installed, diagnostics)
                    except Exception as error:
                        trace.finish(False, str(error))
                        raise
                    trace.finish(bool(result.get("ok")), str(result.get("error") or ""))
            else:
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
                    # "Refresh" asks to look at broken folders again before listing (`heal`).
                    healed = library.heal() if json.loads(command or "{}").get("heal") else []
                    games, transfers = library.list_games(), library.transfers()
                    return {**result, "ok": True, "library": games, "transfers": transfers, "usage": library.usage(), "summary": library.summary(games, transfers), "healed": healed}
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
                    # Live: the app reads .cache/import_scan/progress.json while it runs and writes "cancel" to stop it.
                    from game_scanner.live import ScanReport
                    from launcher_data import data_dir
                    request = json.loads(command or "{}")
                    report = ScanReport(data_dir(self.storage.launcher) / ".cache" / "import_scan")
                    candidates = library.import_scan(request.get("drives", []), folders=request.get("folders", []), report=report)
                    return {**result, "ok": True, "candidates": candidates, "cancelled": report.state["cancelled"]}
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
            if owner and int(owner.get("app_id", -1)) == int(app_id) and action not in ("status", "snapshot", "game-log", "open-folder", "game-options", "launch-diagnose"):
                raise ValueError("Se está congelando o descongelando este juego: esperá a que termine o cancelalo.")
            linked_record = self.storage.linked.get(app_id)
            if action == "kid-entry":
                chosen = str(json.loads(command or "{}").get("folder") or "")
                return {**result, "ok": True, "entry": self.kid_entry(app_id, name, linked_record, chosen)}
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
            if action == "launch-diagnose":
                steam_game = bool(linked_record and linked_record.get("kind") == "steam")
                checked = Path(linked_record["path"]) if linked_record else folder
                level = next((g.get("frozen") for g in GameLibraryManager(self.storage).list_games(with_sizes=False) if g.get("app_id") == app_id and g.get("frozen")), "") or ""
                backups = checked.is_dir() and any(checked.rglob("*.gameaccess-language.bak"))
                requires = self.game_requires(checked, app_id) if checked.is_dir() else needs.merge(None)
                needs_steam = steam_game or requires["steam"]
                return {**result, "ok": True, "folder": str(checked), "requires": requires,
                        "checks": diagnose(checked, needs_steam, steam_game, bool(backups), str(level), requires)}
            if action == "open-launcher":
                # The player signs in there (Game Access never types a password): the launcher is started or brought up.
                from game_execution_manager import store_launchers
                if command not in store_launchers.KNOWN:
                    raise ValueError("Unknown launcher")
                exe = store_launchers.program(command)
                if exe is None:
                    raise ValueError(f"{store_launchers.LAUNCHERS[command]['name']} is not installed")
                os.startfile(str(exe))
                return {**result, "ok": True, "launcher": command}
            if action == "auto-fix":
                # `command`: the fix the server had for this game (or empty).
                steps, learned = self.auto_fix(app_id, name, folder, linked_record, freezer, game_options, json.loads(command or "{}"))
                return {**result, "ok": True, "steps": steps, "fix": learned}
            if action == "save-learned-fix":
                # What made the game run (this PC's fix or the server's): kept in the game's execution profile.
                fix = clean_learned_fix(json.loads(command or "{}"))
                if fix:
                    save_profile(self.storage.launcher, app_id, {**load_profile(self.storage.launcher, app_id), "learnedFix": fix})
                return {**result, "ok": True, "fix": fix}
            if action == "restore-language":
                restored = restore_language(folder, logger)
                options = game_options.load(app_id)
                game_options.save(app_id, name, {**options, "language": KEEP_LANGUAGE})
                return {**result, "ok": True, "restored": restored}
            if action == "game-log":
                # The game's own steps and, when its installer ran, the end of that installer's log (why it stopped).
                from game_execution_manager.setup_installer import LOG_FILE
                if not folder.is_dir():
                    # A folder installed by hand, not yet named with its AppID ("Fix" renames it): its own log.
                    folder = GameLibraryManager(self.storage).identified_folder(app_id) or folder
                    result["folder"] = str(folder)
                installer = folder / LOG_FILE
                tail = installer.read_text(encoding="utf-8", errors="replace").splitlines()[-40:] if installer.is_file() else []
                return {**result, "ok": True, "log": journal.read(folder), "installer_log": "\n".join(tail)}
            if action in ("game-analyze", "game-repair"):
                manager = gem.GameExecutionManager(self.storage, extractor=extractor_for(self.storage.launcher, app_id), logger=logger)
                if action == "game-analyze":
                    return {**result, "ok": True, "analysis": manager.analyze(app_id, name)}
                repaired = manager.repair(app_id, name)
                if repaired.get("ok"):
                    # Ready as it is (a copy unpacked by hand, say): a download that stopped earlier has nothing left
                    # to go on with, or the game would still show as an unfinished download.
                    self.storage.clear_resume(app_id)
                return {**result, **repaired}
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
                if command == "exe":
                    # The folder of the executable the game runs (the one Play remembered), else the game's folder.
                    marker = folder / ".gameaccess_exe"
                    try:
                        found = (folder / marker.read_text(encoding="utf-8").strip()).parent if marker.is_file() else folder
                        folder = found if found.is_dir() else folder
                    except OSError:
                        pass
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
            language = effective_language(options)
            if language == KEEP_LANGUAGE:
                restore_language(folder, logger)
                logger.info("AppID %s: language settings left as they are (the player chose not to change them)", app_id)
            elif options["language"] or supports_language(folder, language):
                self.patch_crack_language(folder, language)
            else:
                # The app's own language is only forced into games that ship it: one set to a language it lacks does not open.
                restore_language(folder, logger)
                logger.info("AppID %s: no %s files found in the game; its language settings stay as its fix has them", app_id, language)
            onlinefix.restore(folder)
            self.start_store_launchers(folder, self.game_requires(folder, app_id)["launchers"])
                
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

def onlinefix_hint(folder: Path) -> bool:
    """A game with an emulator/fix that still asks Steam to be running."""
    return any((folder / name).is_file() for name in ("OnlineFix.ini", "OnlineFix64.dll"))

def run_process(action, app_id, name, command="", working_dir=None, auto_installed=False):
    return DigitalProcessRunner().run(action, app_id, name, command, auto_installed)

def main():
    parser = argparse.ArgumentParser(description="Digital folder lifecycle")
    parser.add_argument("--action", choices=["play", "verify-run", "launch-diagnose", "open-launcher", "auto-fix", "save-learned-fix", "restore-language", "kid-entry", "uninstall", "status", "snapshot", "open-folder", "settings", "save-settings", "local-games", "game-options", "save-game-options", "repair-language", "install-setup", "game-log", "game-analyze", "game-repair", "library-list", "library-plan", "library-space", "library-batch", "library-relocate-plan", "library-relocate", "library-relocate-finish", "library-autofreeze", "import-drives", "import-scan", "import-run", "set-label", "probe-source", "freeze", "deep-freeze", "thaw", "freeze-recover", "steam-status", "steam-save-settings", "steam-sync", "steam-install"], required=True)
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
