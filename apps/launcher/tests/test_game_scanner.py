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


@pytest.fixture(autouse=True)
def no_local_steam(monkeypatch):
    # The scan reads the real Steam client's appinfo.vdf (registry); tests must not depend on this PC's Steam.
    monkeypatch.setattr(GameScanner, "_steam_clients", lambda self, drives: [])


def _manifest(steamapps: Path, app_id: int, name: str, installdir: str):
    steamapps.mkdir(parents=True, exist_ok=True)
    (steamapps / f"appmanifest_{app_id}.acf").write_text(
        f'"AppState"\n{{\n\t"appid"\t\t"{app_id}"\n\t"name"\t\t"{name}"\n\t"installdir"\t\t"{installdir}"\n}}\n')


@pytest.fixture
def disk(tmp_path, monkeypatch):
    monkeypatch.setattr(scanner_module, "MIN_GAME_BYTES", 500)
    disk = tmp_path / "disk"
    _game(disk / "Games" / "Alpha", "Alpha.exe")
    _game(disk / "juegos" / "Repacks" / "Gamma", "gamma.exe")                  # one container deeper
    (disk / "Games" / "Docs").mkdir()
    (disk / "Games" / "Docs" / "readme.txt").write_text("hi")
    _game(disk / "Games" / "OnlyInstaller", "setup.exe")                       # an installer is not a game
    _game(disk / "Downloads" / "Beta", "beta.exe")                            # download folders are never scanned
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
    assert set(by_name) == {"Alpha", "Gamma", "Half Game"}
    assert by_name["Half Game"]["kind"] == "steam" and by_name["Half Game"]["app_id"] == 100 and not by_name["Half Game"]["can_move"]
    assert by_name["Alpha"]["kind"] == "folder" and by_name["Alpha"]["can_move"] and by_name["Alpha"]["executable"].endswith("Alpha.exe")
    assert by_name["Gamma"]["source"] == "library" and not any("duplicate_of" in g for g in games)
    assert [g["size_bytes"] for g in games] == sorted((g["size_bytes"] for g in games), reverse=True)


def test_scan_skips_the_library_itself_and_what_is_already_known(disk):
    games = GameScanner(exclude=[disk / "Games"], known_app_ids=[100]).scan([str(disk)])
    assert {g["name"] for g in games} == {"Gamma"}
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
    assert "Half Game" not in names and {"Alpha", "Gamma"} <= names
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
    assert {g["name"] for g in GameScanner().scan([str(disk)])} == {"Alpha", "Gamma", "Half Game"}


def test_linking_the_same_folder_twice_is_not_an_error(disk, library):
    _, lib = library
    steam = str(disk / "SteamLibrary" / "steamapps" / "common" / "Half")
    item = {"app_id": 100, "name": "Half Game", "path": steam, "mode": "link", "kind": "steam"}
    assert lib.import_games([item])[0]["ok"]
    again = lib.import_games([item])[0]
    assert again["ok"] and again.get("already")
    other = lib.import_games([{**item, "path": str(disk / "Games" / "Alpha")}])[0]
    assert not other["ok"] and "otra carpeta" in other["error"]


def test_scan_reads_the_appid_left_by_emulators_and_fixes(tmp_path, monkeypatch):
    monkeypatch.setattr(scanner_module, "MIN_GAME_BYTES", 500)
    disk = tmp_path / "disk"
    fix = _game(disk / "Games" / "Fixed", "fixed.exe") / "Fixed" / "Binaries" / "Win64"   # Unreal: four levels down
    fix.mkdir(parents=True)
    (fix / "OnlineFix.ini").write_text("[Main]\nRealAppId=2569760\nFakeAppId=480\n")
    (_game(disk / "Games" / "Codex", "codex.exe") / "steam_emu.ini").write_text("[Settings]\n;AppId=1\nAppId=12345\n", encoding="utf-16")
    (_game(disk / "Games" / "Cold", "cold.exe") / "ColdClientLoader.ini").write_text("[SteamClient]\n# AppId=9\nAppId=278080\n")
    (_game(disk / "Games" / "Goldberg", "gold.exe") / "steam_appid.txt").write_text("1664220\n")
    (_game(disk / "Games" / "Placeholder", "space.exe") / "steam_appid.txt").write_text("480")    # the placeholder AppID
    found = {g["name"]: (g["app_id"], g["app_id_file"]) for g in GameScanner().scan([str(disk)])}
    assert found["Fixed"] == (2569760, "OnlineFix.ini")
    assert found["Codex"] == (12345, "steam_emu.ini")
    assert found["Cold"] == (278080, "ColdClientLoader.ini")
    assert found["Goldberg"] == (1664220, "steam_appid.txt")
    assert found["Placeholder"] == (None, "")              # a game that borrows Spacewar's AppID is still a game


def test_scan_skips_programs_and_steam_support_folders(tmp_path, monkeypatch):
    monkeypatch.setattr(scanner_module, "MIN_GAME_BYTES", 500)
    disk = tmp_path / "disk"
    for name in ("Blender 4.2", "ShapeLab", "Foundry VTT", "EasyPose", "Nucleus", "CoreFX", "openbrush", "Blocks", "Ubisoft Connect Services"):
        _game(disk / "Games" / name, "app.exe")
    _game(disk / "Games" / "Real Game", "game.exe")
    steamapps = disk / "SteamLibrary" / "steamapps"
    for app_id, name, installdir in ((480, "Spacewar", "Spacewar"), (228980, "Steamworks Common Redistributables", "Steamworks Shared"),
                                     (1, "Open Brush", "Open Brush"), (2, "Some Steam Game", "SomeGame")):
        _manifest(steamapps, app_id, name, installdir)
        _game(steamapps / "common" / installdir, "run.exe")
    assert {g["name"] for g in GameScanner().scan([str(disk)])} == {"Real Game", "Some Steam Game"}


def test_scan_skips_installer_only_folders_folders_without_exe_and_downloads(tmp_path, monkeypatch):
    monkeypatch.setattr(scanner_module, "MIN_GAME_BYTES", 500)
    disk = tmp_path / "disk"
    _game(disk / "Games" / "Installer Only", "GameSetup.exe")
    (disk / "Games" / "Installer Only" / "unins000.exe").write_bytes(b"x" * 400)
    (disk / "Games" / "Installer Only" / "VC_redist.x64.exe").write_bytes(b"x" * 400)
    _game(disk / "Games" / "No Exe At All", "data2.pak")
    half = _game(disk / "Games" / "Half Downloaded", "game.exe")
    (half / "game.part1.rar.part").write_bytes(b"x" * 400)
    _game(disk / "Games" / "Downloads" / "Inside Games", "game.exe")
    _game(disk / "Descargas" / "Loose Download", "game.exe")
    _game(disk / "Games" / "Kept", "kept.exe")
    steamapps = disk / "SteamLibrary" / "steamapps"
    _manifest(steamapps, 7, "Soundtrack Only", "Soundtrack")
    _game(steamapps / "common" / "Soundtrack", "track.flac")
    assert {g["name"] for g in GameScanner().scan([str(disk)])} == {"Kept"}


def test_scan_skips_what_steam_lists_as_a_tool_or_application(tmp_path, monkeypatch):
    monkeypatch.setattr(scanner_module, "MIN_GAME_BYTES", 500)
    disk = tmp_path / "disk"
    steamapps = disk / "SteamLibrary" / "steamapps"
    for app_id, name in ((10, "A Game"), (11, "A Tool"), (12, "An App"), (13, "Unknown To Steam")):
        _manifest(steamapps, app_id, name, name)
        _game(steamapps / "common" / name, "run.exe")
    (_game(disk / "Games" / "Loose Tool", "tool.exe") / "steam_appid.txt").write_text("14")
    types = {10: "game", 11: "tool", 12: "application", 14: "config"}
    asked = []

    def info(app_ids, clients):
        asked.append(set(app_ids))
        return {i: {"name": f"Steam {i}", "type": t} for i, t in types.items() if i in app_ids}
    monkeypatch.setattr(scanner_module, "steam_app_info", info)
    assert {g["name"] for g in GameScanner().scan([str(disk)])} == {"A Game", "Unknown To Steam"}
    assert asked == [{10, 11, 12, 13, 14}]                   # appinfo.vdf is read once per scan


def test_the_same_game_found_twice_can_only_be_imported_once(tmp_path, monkeypatch):
    monkeypatch.setattr(scanner_module, "MIN_GAME_BYTES", 500)
    disk = tmp_path / "disk"
    for library in ("SteamLibrary", "OtherLibrary"):
        steamapps = disk / library / "steamapps"
        _manifest(steamapps, 100, "Half Game", "Half")
        _game(steamapps / "common" / "Half", "half.exe")
    (_game(disk / "Games" / "Half.Repack", "half.exe", 2000) / "steam_appid.txt").write_text("100")
    _game(disk / "Games" / "Other", "other.exe")
    games = GameScanner().scan([str(disk)])
    halves = [g for g in games if g["app_id"] == 100]
    firsts = [g for g in halves if "duplicate_of" not in g]
    assert len(halves) == 3 and len(firsts) == 1 and firsts[0]["kind"] == "steam"
    assert all(g["duplicate_of"] == firsts[0]["path"] for g in halves if g is not firsts[0])
    assert "duplicate_of" not in next(g for g in games if g["name"] == "Other")


def test_a_folder_found_by_appid_takes_the_steam_name(tmp_path, monkeypatch):
    monkeypatch.setattr(scanner_module, "MIN_GAME_BYTES", 500)
    disk = tmp_path / "disk"
    folder = _game(disk / "Games" / "WRATH.Aeon.of.Ruin.VR.Brutal.Edition", "wrath.exe")
    (folder / "steam_appid.txt").write_text("1000410")
    _game(disk / "Games" / "No AppID Folder", "game.exe")
    monkeypatch.setattr(scanner_module, "steam_app_info", lambda ids, clients: {1000410: {"name": "WRATH: Aeon of Ruin", "type": "game"}})
    by_id = {g["app_id"]: g for g in GameScanner().scan([str(disk)])}
    assert by_id[1000410]["name"] == "WRATH: Aeon of Ruin" and by_id[1000410]["folder_name"] == "WRATH.Aeon.of.Ruin.VR.Brutal.Edition"
    assert by_id[None]["name"] == "No AppID Folder"


def test_steam_names_come_from_the_first_steam_client_with_appinfo(tmp_path, monkeypatch):
    import steam_appinfo
    empty, client = tmp_path / "NoSteam", tmp_path / "Steam"
    (client / "appcache").mkdir(parents=True)
    (client / "appcache" / "appinfo.vdf").write_bytes(b"vdf")
    monkeypatch.setattr(steam_appinfo, "read_local_app_catalog", lambda path, ids: {i: {"name": f"N{i}", "type": "game", "path": str(path)} for i in ids})
    found = scanner_module.steam_app_info({5}, [empty, client])
    assert found[5]["name"] == "N5" and found[5]["path"].startswith(str(client))
    assert scanner_module.steam_app_info({5}, [empty]) == {}


def test_removing_a_linked_game_never_touches_its_files(disk, library):
    storage, lib = library
    alpha = disk / "Games" / "Alpha"
    before = sorted(p.name for p in alpha.rglob("*"))
    lib.import_games([{"app_id": 5, "name": "Alpha", "path": str(alpha), "mode": "link"}])
    storage.uninstall(5, "Alpha")
    assert not storage.linked.get(5) and sorted(p.name for p in alpha.rglob("*")) == before


def test_scan_walks_the_folders_the_player_added(tmp_path, monkeypatch):
    # A folder outside the usual places (C:\games\mc in Seba's PC): each game folder in it is found, and a folder that
    # is itself one game counts as that game; a folder that does not exist is skipped.
    monkeypatch.setattr(scanner_module, "MIN_GAME_BYTES", 500)
    mine = tmp_path / "anywhere" / "mc"
    _game(mine / "MC instance", "launcher.exe")
    _game(mine / "Modpack", "game.exe")
    single = _game(tmp_path / "elsewhere" / "Lonely Game", "lonely.exe")
    games = GameScanner().scan([], [str(mine), str(single), str(tmp_path / "missing")])
    assert {g["name"] for g in games} == {"MC instance", "Modpack", "Lonely Game"}
    assert all(g["source"] == "custom" for g in games)
