"""Linked games: games that stay where they are (a Steam library, an old games folder).

Game Access only launches them and counts their plays. It never renames, moves, writes into or deletes their
folder: the record and the play history live under `.cache/digital_linked`, outside the game."""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from atomic_json import write_json
from launcher_data import data_dir
import game_journal as journal
from game_download_manager.ui_text import ui

KINDS = ("steam", "folder")


def default_command(record: dict) -> str:
    """How a linked game starts when the user set nothing: a Steam game through Steam (as its desktop shortcuts), a
    folder's game with its executable ("" while it is still to be found)."""
    if record.get("kind") == "steam":
        return f"steam://rungameid/{int(record['app_id'])}"
    return f'"{whole_path(record["executable"])}"' if record.get("executable") else ""


def launch_command(record: dict) -> str:
    """A linked game, from Steam or from a folder, is the same thing: only the command that starts it changes."""
    return str(record.get("command") or "").strip() or default_command(record)


WAIT_LINE = re.compile(r"^(?:wait|esperar)\s+(\d{1,3})$", re.I)
MAX_WAIT = 120


def command_lines(command: str) -> list[str]:
    """The launch command, one step per line, run in order (blank lines and # notes are skipped)."""
    return [line.strip() for line in str(command or "").splitlines() if line.strip() and not line.strip().startswith("#")]


def masked(command: str) -> str:
    """The command as it goes into logs: the password after `-login user` never does."""
    return re.sub(r'(-login\s+("[^"]*"|\S+)\s+)("[^"]*"|\S+)', r"\1****", str(command or ""))


def checked_command(command: str) -> str:
    """A launch command the user typed, one step per line: a steam:// address, an existing .exe with its arguments
    (the game's own, or steam.exe -shutdown / -login / -applaunch) or `wait N` (seconds). "" = the default one."""
    from game_execution_manager.launch import parse_arguments
    if "\x00" in str(command or ""):
        raise ValueError("El comando tiene caracteres no válidos.")
    lines = command_lines(command)
    for line in lines:
        wait = WAIT_LINE.match(line)
        if wait:
            if not 0 < int(wait.group(1)) <= MAX_WAIT:
                raise ValueError(f"La espera va de 1 a {MAX_WAIT} segundos.")
            continue
        if line.lower().startswith("steam://"):
            continue
        parts = parse_arguments(line)
        exe = Path(parts[0]) if parts else None
        if exe is None or exe.suffix.lower() != ".exe" or not exe.is_file():
            raise ValueError(f"Cada línea tiene que ser una dirección steam://, un .exe que exista con sus argumentos o «wait N»: {masked(line)}")
    return "\n".join(lines)


def run_sequence(command: str, sleep=time.sleep, probe=None) -> dict:
    """Runs the launch command's steps in order. A step waits for its program to end (up to 10 s) before the next one;
    steam.exe -shutdown also waits until Steam is really closed (up to 30 s), so a -login after it starts a new Steam."""
    from game_execution_manager.launch import parse_arguments
    lines = command_lines(command)
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000008 if sys.platform == "win32" else 0
    pid = None
    for index, line in enumerate(lines):
        last = index == len(lines) - 1
        wait = WAIT_LINE.match(line)
        if wait:
            sleep(min(int(wait.group(1)), MAX_WAIT))
            continue
        if line.lower().startswith("steam://"):
            os.startfile(line)
            continue
        parts = parse_arguments(line)
        process = subprocess.Popen(parts, cwd=str(Path(parts[0]).parent), creationflags=flags, close_fds=True)
        pid = process.pid
        if last:
            break
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        if any(part.lower() == "-shutdown" for part in parts[1:]):
            if probe is None:
                from game_execution_manager.game_processes import running_in as probe
            for _ in range(30):
                if not probe([Path(parts[0]).parent]):
                    break
                sleep(1)
    return {"pid": pid, "command": masked("\n".join(lines))}


class LinkedGames:
    def __init__(self, launcher: Path):
        self.dir = data_dir(launcher) / ".cache" / "digital_linked"

    def get(self, app_id: int) -> dict | None:
        record = self.dir / f"{int(app_id)}.json"
        if not record.is_file():
            return None
        try:
            return json.loads(record.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def all(self) -> list[dict]:
        if not self.dir.is_dir():
            return []
        found = [self.get(int(p.stem)) for p in sorted(self.dir.glob("*.json")) if p.stem.isdigit()]
        return [r for r in found if r]

    def link(self, app_id: int, name: str, path: str, kind: str = "folder", executable: str = "") -> dict:
        if kind not in KINDS:
            raise ValueError("Tipo de vínculo desconocido.")
        folder = Path(path)
        if not folder.is_dir():
            raise ValueError("La carpeta del juego no existe.")
        record = {"app_id": int(app_id), "name": name, "path": str(folder.resolve()), "kind": kind, "executable": whole_path(executable)}
        self.dir.mkdir(parents=True, exist_ok=True)
        write_json(self.dir / f"{int(app_id)}.json", record)
        self.log_dir(app_id).mkdir(parents=True, exist_ok=True)
        journal.note(self.log_dir(app_id), "vinculado", f"{kind}: {record['path']}")
        self.unhide(app_id)
        return record

    def set_command(self, app_id: int, command: str) -> dict:
        """Keeps the launch command of a linked game ("" goes back to the default one)."""
        record = self.get(app_id)
        if not record:
            raise ValueError("El juego no está vinculado.")
        record["command"] = checked_command(command)
        write_json(self.dir / f"{int(app_id)}.json", record)
        self.log_dir(app_id).mkdir(parents=True, exist_ok=True)
        journal.note(self.log_dir(app_id), "opciones", f"comando de ejecución: {masked(launch_command(record)).replace(chr(10), ' / ') or 'automático'}")
        return record

    def set_launch(self, app_id: int, values: dict) -> dict:
        """A folder's game: the executable it runs (relative to its folder, "" = found by itself), its arguments and
        whether it runs as administrator. These replace a command typed before (that one is for Steam games)."""
        from game_execution_manager.launch import checked_executable, parse_arguments
        record = self.get(app_id)
        if not record:
            raise ValueError("El juego no está vinculado.")
        folder = Path(record["path"])
        chosen = str(values.get("executable") or "").strip()
        arguments = str(values.get("arguments") or "").strip()
        parse_arguments(arguments)
        record.update({"executable": str(checked_executable(folder, chosen)) if chosen else "", "arguments": arguments,
                       "administrator": bool(values.get("administrator")), "command": ""})
        write_json(self.dir / f"{int(app_id)}.json", record)
        self.log_dir(app_id).mkdir(parents=True, exist_ok=True)
        journal.note(self.log_dir(app_id), "opciones", "; ".join([f"ejecutable: {chosen or 'automático'}", f"argumentos: {arguments or 'ninguno'}",
                                                                  f"administrador: {'sí' if record['administrator'] else 'no'}"]))
        return record

    def unlink(self, app_id: int, hide: bool = True) -> None:
        """Forget the link and its history. The game itself is never touched. A Steam game the user takes out of the
        library is remembered as hidden, so the automatic Steam import does not bring it back (`hide=False` after an
        uninstall: the game is gone from disk, and an owned one stays offered to install again)."""
        record = self.get(app_id)
        (self.dir / f"{int(app_id)}.json").unlink(missing_ok=True)
        if hide and record and record.get("kind") == "steam":
            self.hide(app_id)

    # -- Steam games the user took out of the library ---------------------------------------------------
    def hidden(self) -> set[int]:
        try:
            return {int(i) for i in json.loads((self.dir / "steam_hidden.json").read_text(encoding="utf-8"))}
        except (OSError, ValueError, TypeError):
            return set()

    def hide(self, app_id: int) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        write_json(self.dir / "steam_hidden.json", sorted(self.hidden() | {int(app_id)}))

    def unhide(self, app_id: int) -> None:
        if int(app_id) in self.hidden():
            write_json(self.dir / "steam_hidden.json", sorted(self.hidden() - {int(app_id)}))

    def log_dir(self, app_id: int) -> Path:
        return self.dir / "logs" / str(int(app_id))

    def log_dirs(self) -> list[Path]:
        return [self.log_dir(r["app_id"]) for r in self.all() if self.log_dir(r["app_id"]).is_dir()]

    def status(self, record: dict) -> dict:
        folder = Path(record["path"])
        present = folder.is_dir()
        return {"folder": str(folder), "installed": present, "state": "linked", "linked": True, "link_kind": record["kind"],
                "needs_repair": False, **({} if present else {"error": "La carpeta vinculada ya no existe."})}


def whole_path(executable: str) -> str:
    """An executable's path as the scan gave it: the last absolute path when the folder was put in front of one that
    already had it ("C:\\games\\X\\C:\\games\\X\\x.exe")."""
    text = str(executable or "").strip()
    starts = [m.start() for m in re.finditer(r"[A-Za-z]:[\\/]", text)]
    return text[starts[-1]:] if len(starts) > 1 else text


def protected_folders() -> list[Path]:
    """Folders a linked game can never be: deleting one would take Windows, programs or the user's own files with it."""
    env = os.environ
    names = ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "USERPROFILE", "PUBLIC", "APPDATA", "LOCALAPPDATA"]
    found = [Path(env[name]) for name in names if env.get(name)]
    home = Path(env["USERPROFILE"]) if env.get("USERPROFILE") else Path.home()
    found += [home / part for part in ("Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos", "OneDrive")]
    return [p.resolve() for p in found]


def deletable_reason(folder: Path, keep: list[Path] = ()) -> str:
    """Why this linked folder must not be deleted as a whole, or "" when it can: a game's own folder, never a disk,
    a system or user folder, one that holds those, a games or downloads root of Game Access, nor one with links inside
    (deleting through a link would reach files outside it)."""
    folder = Path(folder)
    if not folder.is_dir():
        return ui("linkedFolderGone")
    resolved = folder.resolve()
    if resolved == Path(resolved.anchor):
        return ui("linkedDiskRoot")
    for other in [*protected_folders(), *(Path(k).resolve() for k in keep)]:
        if resolved == other or other.is_relative_to(resolved):
            return ui("linkedProtected", folder=str(other))
    for item in [folder, *folder.rglob("*")]:
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            return ui("linkedHasLinks")
    return ""


def run_linked(action: str, record: dict, linked: LinkedGames, logger, find_candidates=None, steam=None, payload: str = "") -> dict:
    """The few things that can be done with a linked game; nothing here writes inside its folder. A Steam game is run
    by Steam, signed in to the account that owns it (`steam`: the Steam Account Manager), with its launch command."""
    app_id, folder = record["app_id"], Path(record["path"])
    if action in ("game-options", "save-game-options") and record.get("kind") == "folder":
        # A folder's game has the same launch options as a game of the library (executable, arguments, administrator);
        # the launch command with its steps is for Steam games.
        from game_execution_manager.game_options import game_executables
        if action == "save-game-options":
            record = linked.set_launch(app_id, json.loads(payload or "{}"))
            logger.info("AppID %s: linked launch options saved; executable=%s; arguments=%s; administrator=%s", app_id,
                        record["executable"] or "automatic", record["arguments"] or "none", record["administrator"])
        exe = whole_path(record.get("executable") or "")
        try:
            relative = str(Path(exe).resolve().relative_to(folder.resolve())) if exe else ""
        except ValueError:
            relative = exe
        return {"linked": True, "kind": "folder", "executables": game_executables(folder),
                "options": {"executable": relative, "arguments": str(record.get("arguments") or ""),
                            "administrator": bool(record.get("administrator")), "language": "", "backupEnabled": False, "backupArchive": ""}}
    if action in ("game-options", "save-game-options"):
        if action == "save-game-options":
            record = linked.set_command(app_id, json.loads(payload or "{}").get("command", ""))
            logger.info("AppID %s: launch command saved: %s", app_id, masked(launch_command(record)).replace(chr(10), " / ") or "automatic")
        return {"linked": True, "command": str(record.get("command") or ""), "default_command": default_command(record)}
    if action == "status":
        return linked.status(record)
    if action == "uninstall":
        linked.unlink(app_id)
        logger.info("AppID %s: link removed; the game's files were not touched (%s)", app_id, folder)
        return {"exit_code": 0, "unlinked": True}
    if action == "open-folder":
        if not folder.is_dir():
            raise ValueError("No existe la carpeta del juego.")
        os.startfile(str(folder))
        return {}
    if action == "game-log":
        return {"log": journal.read(linked.log_dir(app_id))}
    if action == "game-analyze":
        return {"analysis": {"state": "ready", "ready": True, "warning": "", "needs": [], "executable": record.get("executable", "")}}
    if action == "game-repair":
        return {"ok": True}
    if action == "play":
        if not folder.is_dir():
            raise ValueError("La carpeta vinculada ya no existe.")
        custom = str(record.get("command") or "").strip()
        steps = command_lines(custom)
        if steps and not (len(steps) == 1 and steps[0].lower().startswith("steam://")):
            # The user's own steps, in order: sign Steam out and in to an account, run the game's executable without
            # Steam (some games open better that way)... A single steam:// address still goes through the owner's account.
            outcome = run_sequence(custom)
            linked.log_dir(app_id).mkdir(parents=True, exist_ok=True)
            journal.note(linked.log_dir(app_id), "play", f"lanzado: {outcome['command']}" + (f" (pid {outcome['pid']})" if outcome["pid"] else ""))
            return outcome
        if record["kind"] == "steam" or custom:
            command = launch_command(record)
            if steam is not None:
                outcome = steam.play(app_id, command)
            else:
                os.startfile(command)
                outcome = {"command": command}
            linked.log_dir(app_id).mkdir(parents=True, exist_ok=True)
            owner = outcome.get("steam_owner")
            journal.note(linked.log_dir(app_id), "play", f"lanzado: Steam{f' ({owner})' if owner else ''}")
            return outcome
        exe = Path(whole_path(record["executable"])) if record.get("executable") else None
        if not exe or not exe.is_file():
            candidates = find_candidates(folder, record["name"]) if find_candidates else []
            exe = candidates[0][0] if candidates else None
        if exe is None:
            raise ValueError("No se encontró el ejecutable del juego vinculado.")
        from game_execution_manager.launch import parse_arguments
        arguments = parse_arguments(str(record.get("arguments") or ""))
        if record.get("administrator"):
            from game_execution_manager.launch import launch_as_administrator
            linked.log_dir(app_id).mkdir(parents=True, exist_ok=True)
            pid = launch_as_administrator(exe, arguments, exe.parent)
            journal.note(linked.log_dir(app_id), "play", f"lanzado como administrador: {exe.name}" + (f" {' '.join(arguments)}" if arguments else "") + f" (pid {pid})")
            return {"pid": pid, "command": str(exe), "administrator": True}
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000008 if sys.platform == "win32" else 0
        linked.log_dir(app_id).mkdir(parents=True, exist_ok=True)
        try:
            process = subprocess.Popen([str(exe), *arguments], cwd=str(exe.parent), creationflags=flags, close_fds=True)
        except OSError as error:
            if getattr(error, "winerror", None) != 740:
                raise
            # The game asks for administrator rights (WinError 740): Windows asks the player, as Play does for a game
            # set to run as administrator.
            from game_execution_manager.launch import launch_as_administrator
            journal.note(linked.log_dir(app_id), "play", f"{exe.name} pide permisos de administrador; se lanza como administrador")
            pid = launch_as_administrator(exe, arguments, exe.parent)
            journal.note(linked.log_dir(app_id), "play", f"lanzado como administrador: {exe.name} (pid {pid})")
            logger.info("AppID %s: linked game launched as administrator; executable=%s; pid=%s", app_id, exe, pid)
            return {"pid": pid, "command": str(exe), "administrator": True}
        journal.note(linked.log_dir(app_id), "play", f"lanzado: {exe.name}" + (f" {' '.join(arguments)}" if arguments else "") + f" (pid {process.pid})")
        logger.info("AppID %s: linked game launched; executable=%s; pid=%s", app_id, exe, process.pid)
        return {"pid": process.pid, "command": str(exe)}
    raise ValueError("Esta acción no está disponible para juegos vinculados: sus archivos no se modifican.")
