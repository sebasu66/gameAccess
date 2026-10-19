import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_journal as journal
import game_scanner.scanner as scanner_module
from game_library_manager import GameLibraryManager
from game_library_manager.linked import run_linked
from game_library_manager.storage import DigitalGameStorage
from game_scanner import GameScanner, is_steam_path


def _game(folder: Path, exe: str, size: int = 400):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / exe).write_bytes(b"x" * size)
    (folder / "data.pak").write_bytes(b"d" * size)
    return folder


@pytest.fixture
def disk(tmp_path, monkeypatch):
    monkeypatch.setattr(scanner_module, "MIN_GAME_BYTES", 500)
    disk = tmp_path / "disk"
    _game(disk / "Games" / "Alpha", "Alpha.exe")
    _game(disk / "juegos" / "Repacks" / "Gamma", "gamma.exe")                  # one container deeper
    (disk / "Games" / "Docs").mkdir()
    (disk / "Games" / "Docs" / "readme.txt").write_text("hi")
    _game(disk / "Games" / "OnlyInstaller", "setup.exe")                       # an installer is not a game
    _game(disk / "Downloads" / "Beta", "beta.exe")
    steamapps = disk / "SteamLibrary" / "steamapps"
    steamapps.mkdir(parents=True)
    (steamapps / "appmanifest_100.acf").write_text('"AppState"\n{\n\t"appid"\t\t"100"\n\t"name"\t\t"Half Game"\n\t"installdir"\t\t"Half"\n}\n')
    _game(steamapps / "common" / "Half", "half.exe")
    _game(disk / "Program Files (x86)" / "Steam" / "steamapps" / "common" / "Loose", "loose.exe")
    (disk / "Program Files (x86)" / "Steam" / "steam.exe").parent.mkdir(parents=True, exist_ok=True)
    return disk


def test_scan_finds_games_in_the_usual_places_and_nothing_else(disk):
    games = GameScanner().scan([str(disk)])
    by_name = {g["name"]: g for g in games}
    assert set(by_name) == {"Alpha", "Gamma", "Beta", "Half Game"}
    assert by_name["Half Game"]["kind"] == "steam" and by_name["Half Game"]["app_id"] == 100 and not by_name["Half Game"]["can_move"]
    assert by_name["Alpha"]["kind"] == "folder" and by_name["Alpha"]["can_move"] and by_name["Alpha"]["executable"].endswith("Alpha.exe")
    assert by_name["Beta"]["source"] == "downloads" and by_name["Gamma"]["source"] == "library"
    assert [g["size_bytes"] for g in games] == sorted((g["size_bytes"] for g in games), reverse=True)


def test_scan_skips_the_library_itself_and_what_is_already_known(disk):
    games = GameScanner(exclude=[disk / "Games"], known_app_ids=[100]).scan([str(disk)])
    assert {g["name"] for g in games} == {"Gamma", "Beta"}
    assert is_steam_path(disk / "SteamLibrary" / "steamapps" / "common" / "Half") and not is_steam_path(disk / "Games" / "Alpha")


@pytest.fixture
def library(tmp_path):
    storage = DigitalGameStorage(tmp_path / "launcher")
    return storage, GameLibraryManager(storage)


def test_link_keeps_the_game_untouched_and_tracks_plays(disk, library, monkeypatch):
    storage, lib = library
    steam = disk / "SteamLibrary" / "steamapps" / "common" / "Half"
    before = sorted(p.name for p in steam.rglob("*"))
    assert lib.import_games([{"app_id": 100, "name": "Half Game", "path": str(steam), "mode": "link", "kind": "steam"}])[0]["ok"]
    game = {g["app_id"]: g for g in lib.list_games()}[100]
    assert game["linked"] and game["state"] == "linked" and game["standard"] and game["link_kind"] == "steam" and game["size_bytes"] == 800
    record = storage.linked.get(100)
    started = []
    monkeypatch.setattr(scanner_module.os, "startfile", lambda target: started.append(target), raising=False)
    import game_library_manager.linked as linked_module
    monkeypatch.setattr(linked_module.os, "startfile", lambda target: started.append(target), raising=False)
    run_linked("play", record, storage.linked, __import__("logging").getLogger("t"))
    assert started == ["steam://rungameid/100"]
    assert lib.list_games()[0]["plays"] == 1 and sum(lib.usage()["by_day"].values()) == 1
    assert lib.summary()["used_bytes"] == 0 and lib.summary()["linked_count"] == 1 and lib.summary()["count"] == 1
    assert sorted(p.name for p in steam.rglob("*")) == before                      # nothing was written inside the game
    assert storage.status(100, "Half Game")["state"] == "linked" and storage.set_status(100, "Half Game", "ready") == steam
    assert steam.name == "Half"


def test_linked_games_are_never_fixed_or_deleted(disk, library):
    storage, lib = library
    folder = _game(disk / "Games" / "Alpha", "Alpha.exe")
    lib.import_games([{"app_id": 5, "name": "Alpha", "path": str(folder), "mode": "link"}])
    assert lib.plan([5]) == []
    for action in ("adopt", "repair", "analyze", "discard_transfer"):
        assert not lib.batch(action, [5])[0]["ok"]
    assert lib.batch("uninstall", [5])[0]["ok"]                                    # only the link goes
    assert folder.is_dir() and (folder / "Alpha.exe").is_file() and not storage.linked.get(5)
    assert not any(g["app_id"] == 5 for g in lib.list_games())


def test_steam_games_can_only_be_linked_and_folders_can_be_moved(disk, library):
    storage, lib = library
    steam = disk / "SteamLibrary" / "steamapps" / "common" / "Half"
    refused = lib.import_games([{"app_id": 100, "name": "Half Game", "path": str(steam), "mode": "move", "kind": "steam"}])[0]
    assert not refused["ok"] and "Steam" in refused["error"] and steam.is_dir()
    alpha = disk / "Games" / "Alpha"
    moved = lib.import_games([{"app_id": 5, "name": "Alpha", "path": str(alpha), "mode": "move"}])[0]
    assert moved["ok"] and not alpha.exists()
    folder = storage.folder(5, "Alpha")
    assert folder.name == "5-Alpha-ready" and "importado" in journal.read(folder)
    duplicate = lib.import_games([{"app_id": 5, "name": "Alpha", "path": str(disk / "Downloads" / "Beta"), "mode": "link"}])[0]
    assert not duplicate["ok"]


def test_scan_through_the_library_hides_what_is_already_imported(disk, library):
    storage, lib = library
    lib.import_games([{"app_id": 100, "name": "Half Game", "path": str(disk / "SteamLibrary" / "steamapps" / "common" / "Half"), "mode": "link", "kind": "steam"}])
    names = {g["name"] for g in lib.import_scan([str(disk)])}
    assert "Half Game" not in names and {"Alpha", "Beta", "Gamma"} <= names
    assert lib.import_drives() and all({"path", "total_bytes", "free_bytes"} <= set(d) for d in lib.import_drives())


def test_one_unreadable_folder_does_not_stop_the_scan_of_the_disk(disk, monkeypatch):
    # Windows refuses to read some folders (WpSystem gives WinError 1337); before, that ended the scan of the disk.
    (disk / "WpSystem").mkdir()
    real = Path.is_dir

    def is_dir(self):
        if "WpSystem" in self.parts:
            raise OSError(1337, "La estructura del identificador de seguridad no es válida")
        return real(self)
    monkeypatch.setattr(Path, "is_dir", is_dir)
    assert {g["name"] for g in GameScanner().scan([str(disk)])} == {"Alpha", "Gamma", "Beta", "Half Game"}


def test_linking_the_same_folder_twice_is_not_an_error(disk, library):
    _, lib = library
    steam = str(disk / "SteamLibrary" / "steamapps" / "common" / "Half")
    item = {"app_id": 100, "name": "Half Game", "path": steam, "mode": "link", "kind": "steam"}
    assert lib.import_games([item])[0]["ok"]
    again = lib.import_games([item])[0]
    assert again["ok"] and again.get("already")
    other = lib.import_games([{**item, "path": str(disk / "Games" / "Alpha")}])[0]
    assert not other["ok"] and "otra carpeta" in other["error"]
