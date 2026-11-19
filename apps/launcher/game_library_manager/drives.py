"""The library on several disks (Seba, 2026-11-17). Each disk the player enables in Manager › Space gets a folder named
like the games folder (`C:\\GA_Juegos` → `D:\\GA_Juegos`); its games are found like the others (storage.roots), new
games go to the folder with most room (storage.install_root) and a game can be moved from one disk to another.

A move to another disk is a heavy disk job like a freeze: one at a time (the freeze lock), its progress in
`<appid>.progress.json` with the action "drive-move" (the game's row in the desktop), cancel and pause from the app.
The original is removed only once every file was copied; cancelled or failed, the half-made copy goes and the game
stays where it was. Cut short by the app closing, GameFreezer.recover puts it right."""
from __future__ import annotations
import os
import re
import shutil
import time
from pathlib import Path

import game_journal as journal
from disk_space import GIB, folder_size
from game_paths import fits, longest_inside
from game_scanner import GameScanner
from .freeze_control import FreezeBusy, FreezeCancelled
from .mover import move_folder, staging_of

GAME_FOLDER = re.compile(r"^\d+-")


def _volume_name(drive: str) -> str:
    """The disk's own name ("Juegos", "Backup"), or "" (no name, or not Windows)."""
    if os.name != "nt":
        return ""
    try:
        import ctypes
        name = ctypes.create_unicode_buffer(261)
        if ctypes.windll.kernel32.GetVolumeInformationW(drive, name, 261, None, None, None, None, 0):
            return name.value
    except (OSError, AttributeError):
        pass
    return ""


def _games_in(folder: Path) -> int:
    try:
        return sum(1 for item in folder.iterdir() if item.is_dir() and GAME_FOLDER.match(item.name))
    except OSError:
        return 0


def _drive(path: Path) -> str:
    return (Path(path).resolve().drive or Path(path).resolve().anchor).upper()


class LibraryDrives:
    # A disk reading this fast or more is recommended for installing games; a slower one (or a hard disk) for downloads.
    FAST_MBPS = 400

    def __init__(self, library):
        self.library = library
        self.storage = library.storage

    def _folder_on(self, drive: str) -> Path:
        return self.storage.library_folder_on(_drive(Path(drive)))

    def _refresh_roots(self) -> None:
        settings = self.storage.preferences.load()
        self.storage.drive_roots = [Path(root).resolve() for root in settings.get("library_drives", []) if Path(root).is_dir()]
        self.storage.roots = list(dict.fromkeys([*self.storage.library_roots(), *self.storage.roots]))

    def profile(self, only_missing: bool = True) -> list[dict]:
        """What every disk is, asked of Windows (disk_profile.py): the ones not looked at yet when Space opens,
        all of them with "Rescan disks". Nothing is written to or read from the disks."""
        from .disk_profile import DiskProfiles
        letters = [_drive(Path(disk["path"])) for disk in GameScanner.drives()]
        DiskProfiles(self.storage.data).refresh(letters, only_missing=only_missing)
        return self.list()

    def list(self) -> list[dict]:
        """Every fixed disk: its room and name, what it may be used for (`roles`), what it is,
        what is recommended for it, how many games of ours it holds, and where the next download and install go.
        Older keys stay for the screens that read them: `enabled` (used for something), `install` (the next game is
        installed here), `temporary` (the next download goes here), `primary` (the games folder's disk)."""
        from .disk_profile import DiskProfiles, speed_of
        storage = self.storage
        profiles = DiskProfiles(storage.data)
        primary = _drive(storage.root)
        library_letters = {_drive(root) for root in storage.library_roots()}
        next_install = _drive(storage.install_root())
        next_download = _drive(storage.pick(storage.download_roots(), 0))
        disks = GameScanner.drives()
        biggest = max((disk["total_bytes"] for disk in disks), default=0)
        found = []
        for disk in disks:
            letter = _drive(Path(disk["path"]))
            folder = storage.library_folder_on(letter)
            has_folder = letter in library_letters and (folder.is_dir() or letter == primary)
            install = has_folder and storage.role(letter, "install")
            download = storage.role(letter, "download")
            profile = profiles.known(letter)
            kind = (profile or {}).get("kind") or "unknown"
            # Good for installing: a solid-state disk inside the PC (speed_of already drops the ones over USB).
            fast = kind in ("nvme", "ssd") and speed_of(profile) >= self.FAST_MBPS
            recommended = ["install"] if fast else []
            if not fast or disk["total_bytes"] == biggest:
                recommended.append("download")
            found.append({**disk, "letter": letter, "name": _volume_name(disk["path"]), "primary": letter == primary,
                          "enabled": install or download, "roles": {"install": install, "download": download},
                          "folder": str(folder), "download_folder": str(storage.temporary_folder_on(letter)),
                          "games": _games_in(folder) if has_folder else 0,
                          "kind": kind, "model": (profile or {}).get("model", ""), "bus": (profile or {}).get("bus", ""),
                          "external": bool((profile or {}).get("external")), "known": profile is not None, "recommended": recommended,
                          # Under its reserve a disk takes nothing new (storage.keep_free).
                          "reserve_bytes": storage.keep_free(disk["total_bytes"]),
                          "too_full": disk["free_bytes"] < storage.keep_free(disk["total_bytes"]),
                          "install": install and letter == next_install, "temporary": download and letter == next_download})
        return found

    def set(self, drive: str, on: bool) -> list[dict]:
        """Turn a disk on or off for installing games (the older single switch)."""
        return self.set_role(drive, "install", on)

    def set_role(self, drive: str, role: str, on: bool) -> list[dict]:
        """Allow a disk to install games (its library folder is made) or to hold downloads (its temporary folder is
        made), or stop it. A disk holding games of ours keeps installing until they are moved or uninstalled; one with
        a download under way keeps downloads; at least one disk stays for each."""
        if role not in ("install", "download"):
            raise ValueError("Rol de disco desconocido.")
        disks = {_drive(Path(disk["path"])): disk["path"] for disk in GameScanner.drives()}
        letter = _drive(Path(drive))
        if letter not in disks:
            raise ValueError("Ese disco no está conectado o no es un disco fijo.")
        storage = self.storage
        listed = {disk["letter"]: disk for disk in self.list()}
        if role == "install":
            folder = storage.library_folder_on(letter)
            if on:
                if folder.is_symlink() or (hasattr(folder, "is_junction") and folder.is_junction()):
                    raise ValueError("La carpeta de ese disco no puede ser un enlace.")
                folder.mkdir(parents=True, exist_ok=True)
                if folder != storage.root:
                    storage.preferences.set_library_drives([*map(str, storage.drive_roots), str(folder)])
            else:
                if folder.is_dir() and _games_in(folder):
                    raise ValueError("Ese disco todavía tiene juegos de la biblioteca: movelos a otro disco antes de dejar de usarlo.")
                if not any(disk["roles"]["install"] for other, disk in listed.items() if other != letter):
                    raise ValueError("Tiene que quedar al menos un disco para instalar juegos.")
                if folder != storage.root:
                    storage.preferences.set_library_drives([str(root) for root in storage.drive_roots if _drive(root) != letter])
        else:
            folder = storage.temporary_folder_on(letter)
            if on:
                if folder.is_symlink() or (hasattr(folder, "is_junction") and folder.is_junction()):
                    raise ValueError("La carpeta de ese disco no puede ser un enlace.")
                folder.mkdir(parents=True, exist_ok=True)
            else:
                if any(t["active"] and _drive(Path(t["folder"])) == letter for t in storage.transfers()):
                    raise ValueError("Hay una descarga en curso en ese disco: esperá a que termine o cancelala.")
                if not any(disk["roles"]["download"] for other, disk in listed.items() if other != letter):
                    raise ValueError("Tiene que quedar al menos un disco para las descargas.")
        storage.preferences.set_drive_role(letter, role, on)
        self._refresh_roots()
        return self.list()

    # -- free a disk (Seba, 2026-11-18) -----------------------------------------------------------------------------
    def _games_on(self, letter: str) -> list[dict]:
        return [game for game in self.library.list_games(with_sizes=True)
                if game.get("app_id") is not None and game.get("folder") and _drive(Path(game["folder"])) == letter
                and not game.get("linked") and game.get("state") != "steam_owned"]

    def evacuate_plan(self, source: str, target: str = "auto") -> dict:
        """Every game of ours on `source` and the disk it would go to: `target` "auto" spreads them over the other
        install disks evenly by room (the biggest game first, to the disk with most room left), or a letter sends them
        all there. Says what does not fit before anything moves, and which games cannot move now (frozen, unfinished)."""
        from disk_space import SAFETY_MARGIN
        letter = _drive(Path(source))
        listed = {disk["letter"]: disk for disk in self.list()}
        if target == "auto":
            targets = [other for other, disk in listed.items() if other != letter and disk["roles"]["install"]]
        else:
            targets = [_drive(Path(target))]
            if targets[0] == letter:
                raise ValueError("Elegí otro disco como destino.")
            if not listed.get(targets[0], {}).get("roles", {}).get("install"):
                raise ValueError("Ese disco no está habilitado para instalar juegos.")
        if not targets:
            raise ValueError("No hay otro disco habilitado para instalar juegos: activá uno primero.")
        # Each target keeps its reserve free (storage.keep_free).
        room = {other: listed[other]["free_bytes"] - self.storage.keep_free(listed[other]["total_bytes"]) - SAFETY_MARGIN for other in targets}
        moves, skipped, short = [], [], {}
        for game in sorted(self._games_on(letter), key=lambda g: -(g.get("size_bytes") or 0)):
            reason = ("frozen" if game.get("frozen") else "unfinished" if game.get("partial") or game.get("unfinished") else "")
            if reason:
                skipped.append({"app_id": game["app_id"], "name": game["name"], "reason": reason})
                continue
            size = int(game.get("size_bytes") or 0)
            best = max(targets, key=lambda other: room[other])
            if room[best] < size:
                short[best] = short.get(best, 0) + size
            room[best] -= size
            moves.append({"app_id": game["app_id"], "name": game["name"], "bytes": size, "target": best,
                          "folder": str(self.storage.library_folder_on(best))})
        lacking = [{"drive": other, "missing_bytes": -room[other]} for other in targets if room[other] < 0]
        return {"ok": not lacking, "source": letter, "moves": moves, "skipped": skipped, "short": lacking,
                "bytes": sum(move["bytes"] for move in moves)}

    def _batch_file(self) -> Path:
        return self.storage.data / ".cache" / "drive-batch.json"

    def evacuate(self, source: str, target: str = "auto") -> dict:
        """Free a disk: the plan is checked first (nothing moves if something does not fit), then each game moves on
        its own and whole (move). A cancel of the game moving stops the whole job: the games already moved stay
        moved, the one being copied stays where it was, the rest were not touched."""
        from atomic_json import write_json
        plan = self.evacuate_plan(source, target)
        if not plan["ok"]:
            return {**plan, "started": False}
        state = {**plan, "done": 0, "current": None, "results": [], "finished": False, "started_at": time.time()}
        write_json(self._batch_file(), state)
        for move in plan["moves"]:
            state["current"] = move["app_id"]
            write_json(self._batch_file(), state)
            try:
                result = self.move(move["app_id"], move["folder"])
            except (OSError, ValueError) as error:
                result = {"ok": False, "error": str(error)}
            state["results"].append({"app_id": move["app_id"], **result})
            if result.get("ok"):
                state["done"] += 1
            if result.get("cancelled"):
                state["cancelled"] = True
                break
        state.update(current=None, finished=True, finished_at=time.time())
        write_json(self._batch_file(), state)
        return {**state, "started": True}

    def move(self, app_id: int, target: str) -> dict:
        """One library game to the library's folder on another disk, with its progress (see the module's note)."""
        app_id = int(app_id)
        game = next((g for g in self.library.list_games(with_sizes=False) if g.get("app_id") == app_id), None)
        if game is None:
            raise ValueError("Ese juego no está en la biblioteca.")
        if game.get("linked") or game.get("state") == "steam_owned":
            raise ValueError("Un juego vinculado se queda en su carpeta: no se mueve entre los discos de la biblioteca.")
        if game.get("frozen"):
            raise ValueError("Descongelá el juego antes de moverlo a otro disco.")
        if game.get("partial") or game.get("unfinished"):
            raise ValueError("Esperá a que termine de descargarse antes de moverlo.")
        name = game["name"]
        source = self.storage.folder(app_id, name)
        root = Path(target).resolve()
        if root not in self.storage.library_roots():
            raise ValueError("Ese disco no está habilitado para la biblioteca.")
        if source.parent.resolve() == root:
            return {"ok": True, "unchanged": True}
        destination = root / source.name
        if destination.exists():
            raise ValueError(f"Ya existe una carpeta con ese nombre en {root}.")
        size = folder_size(source)
        usage = shutil.disk_usage(root)
        if usage.free - size - GIB < self.storage.keep_free(usage.total):
            raise ValueError("No hay espacio suficiente en ese disco para este juego dejando libre la reserva del disco.")
        longest = longest_inside(source)
        if not fits(destination, longest):
            raise ValueError("Una ruta del juego quedaría demasiado larga en ese disco.")
        freezer = self.library.freezer
        control = freezer._control(app_id)
        try:
            control.acquire("move")
        except FreezeBusy as error:
            return {"ok": False, "error": str(error)}
        progress = freezer._progress(app_id, "drive-move", source)
        progress.state.update(source=str(source), target=str(destination), name=name)
        started = time.time()
        journal.note(source, "move", f"moviendo a otro disco: {destination}")
        try:
            moved = move_folder(source, destination, progress, control.checkpoint)
        except FreezeCancelled:
            progress.finish(False, cancelled=True)
            journal.note(source, "move", "cancelado: el juego sigue en su disco")
            return {"ok": False, "cancelled": True}
        except (OSError, ValueError, RuntimeError) as error:
            # The original is whole until the copy ends: the half-made copy goes.
            if source.is_dir():
                shutil.rmtree(staging_of(destination), ignore_errors=True)
                if destination.is_dir():
                    shutil.rmtree(destination, ignore_errors=True)
            progress.finish(False, error=str(error))
            journal.note(source if source.is_dir() else destination, "move", f"no se pudo mover: {error}")
            return {"ok": False, "error": str(error)}
        finally:
            control.release()
        if (self.storage.registry / f"{app_id}.json").is_file():
            self.storage._write_record(app_id, destination, name)
        seconds = round(time.time() - started, 1)
        progress.finish(True, moved=moved["bytes"], seconds=seconds)
        journal.note(destination, "move", f"movido desde {source} en {seconds:.0f} s ({moved['bytes']} bytes)")
        return {"ok": True, "moved_bytes": moved["bytes"], "seconds": seconds, "folder": str(destination)}
