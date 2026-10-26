import io
import json
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from steam_account_manager import SteamAccountManager, vdf
from steam_account_manager import manager as steam_manager_module
from steam_account_manager.client import SteamAccount, read_accounts, read_libraries, read_manifest, installed_games, id64
from steam_account_manager.ownership import pick_owner, ownership_table, fetch_owned_games
from steam_account_manager.switch import SteamSwitcher
from game_library_manager import GameLibraryManager
from game_library_manager.linked import run_linked
from game_library_manager.storage import DigitalGameStorage

OWNER, OTHER, BORROWER = "76561198000000001", "76561198000000002", "76561198000000003"
STRANGER = "76561198000000004"          # in loginusers.vdf without "Remember me"
SERVER = "https://api.example.test"


class Log:
    def info(self, *args): pass
    warning = error = info


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _manifest(steamapps: Path, app_id: int, name: str, owner: str, flags: int = 4, folder: bool = True):
    _write(steamapps / f"appmanifest_{app_id}.acf",
           f'"AppState"\n{{\n\t"appid"\t\t"{app_id}"\n\t"name"\t\t"{name}"\n\t"StateFlags"\t\t"{flags}"\n'
           f'\t"installdir"\t\t"{name}"\n\t"SizeOnDisk"\t\t"1234"\n\t"LastOwner"\t\t"{owner}"\n}}\n')
    if folder:
        (steamapps / "common" / name).mkdir(parents=True, exist_ok=True)


def _steam(tmp_path: Path) -> Path:
    root = tmp_path / "Steam"
    (root / "steam.exe").parent.mkdir(parents=True, exist_ok=True)
    (root / "steam.exe").write_bytes(b"")
    _write(root / "config" / "loginusers.vdf", f'''"users"
{{
\t"{OWNER}"
\t{{
\t\t"AccountName"\t\t"owner_acc"
\t\t"PersonaName"\t\t"Owner \\"Big\\" One"
\t\t"RememberPassword"\t\t"1"
\t\t"MostRecent"\t\t"1"
\t}}
\t"{OTHER}"
\t{{
\t\t"AccountName"\t\t"other_acc"
\t\t"PersonaName"\t\t"Other"
\t\t"RememberPassword"\t\t"1"
\t}}
\t"{STRANGER}"
\t{{
\t\t"AccountName"\t\t"stranger"
\t\t"RememberPassword"\t\t"0"
\t}}
}}
''')
    second = tmp_path / "Library2"
    _write(root / "steamapps" / "libraryfolders.vdf", f'''"libraryfolders"
{{
\t"0"
\t{{
\t\t"path"\t\t"{str(root).replace(chr(92), chr(92) * 2)}"
\t}}
\t"1"
\t{{
\t\t"path"\t\t"{str(second).replace(chr(92), chr(92) * 2)}"
\t\t"apps"
\t\t{{
\t\t\t"20"\t\t"1"
\t\t}}
\t}}
}}
''')
    _manifest(root / "steamapps", 10, "Alpha", OWNER)
    _manifest(second / "steamapps", 20, "Beta", OTHER)
    _manifest(second / "steamapps", 30, "Gamma", OWNER, flags=1026)          # still updating
    _manifest(second / "steamapps", 40, "Delta", STRANGER)                    # its owner is not remembered
    return root


# -- VDF ---------------------------------------------------------------------------------------------
def test_vdf_reads_nesting_escapes_comments_and_conditionals():
    data = vdf.loads('// header\n"Root"\n{\n\t"Name"\t"a \\"q\\" \\\\ b"\n\t"Sub" [$WIN32]\n\t{\n\t\t"k"\t\t"v" [$WIN64]\n\t}\n'
                     '\tbare\tvalue\n}\n')
    assert data["Root"]["Name"] == 'a "q" \\ b'
    assert data["Root"]["Sub"] == {"k": "v"}
    assert data["Root"]["bare"] == "value"


def test_vdf_child_ignores_key_case_and_missing_keys():
    data = vdf.loads('"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "Apps" { "440" { "Playtime" "5" } } } } } }')
    assert vdf.child(data, "userlocalconfigstore", "software", "valve", "steam", "apps", "440", "playtime") == "5"
    assert vdf.child(data, "nope", "deeper") is None
    assert vdf.load(Path("does-not-exist.vdf")) == {}


def test_vdf_tolerates_bom_and_unbalanced_braces():
    assert vdf.loads('\ufeff"a" { "b" "c" } }')["a"] == {"b": "c"}


# -- Steam client files ----------------------------------------------------------------------------------
def test_reads_remembered_accounts(tmp_path):
    accounts = read_accounts(_steam(tmp_path))
    assert [(a.account_name, a.remembered, a.most_recent) for a in accounts] == [("owner_acc", True, True), ("other_acc", True, False), ("stranger", False, False)]
    assert accounts[0].persona_name == 'Owner "Big" One'
    assert accounts[0].account_id == 39734273 and id64(accounts[0].account_id) == OWNER


def test_reads_every_library_once_new_and_old_format(tmp_path):
    root = _steam(tmp_path)
    assert [p.parent.name for p in read_libraries(root)] == ["Steam", "Library2"]
    _write(root / "steamapps" / "libraryfolders.vdf", '"LibraryFolders"\n{\n\t"TimeNextStatsReport"\t"1"\n\t"1"\t"D:\\\\Games"\n}\n')
    assert [str(p) for p in read_libraries(root)][1] == str(Path("D:/Games/steamapps"))


def test_reads_manifests_with_owner_and_install_state(tmp_path):
    root = _steam(tmp_path)
    games = {g.app_id: g for g in installed_games(read_libraries(root))}
    assert set(games) == {10, 20, 30, 40}
    assert games[10].owner_id64 == OWNER and games[10].fully_installed and games[10].size_bytes == 1234
    assert games[20].owner_id64 == OTHER and Path(games[20].folder).name == "Beta"
    assert not games[30].fully_installed
    _write(root / "steamapps" / "appmanifest_480.acf", '"AppState" { "appid" "480" "installdir" "Spacewar" }')
    _write(root / "steamapps" / "appmanifest_99.acf", '"AppState" { "appid" "x" }')
    assert read_manifest(root / "steamapps" / "appmanifest_480.acf") is None
    assert read_manifest(root / "steamapps" / "appmanifest_99.acf") is None


# -- ownership ---------------------------------------------------------------------------------------------
ACCOUNTS = [SteamAccount(OWNER, "owner_acc", "Owner", True, True), SteamAccount(OTHER, "other_acc", "Other", False, False),
            SteamAccount(BORROWER, "borrower", "Borrower", True, False)]


def test_installed_copy_belongs_to_its_last_owner():
    assert pick_owner(10, ACCOUNTS, {OWNER: [10], OTHER: [10]}, installed_owner=OTHER).account_name == "other_acc"


def test_not_installed_prefers_the_signed_in_owner_then_a_remembered_one():
    owned = {OWNER: [5], OTHER: [5]}
    assert pick_owner(5, ACCOUNTS, owned, active_id64=OTHER).account_name == "other_acc"
    assert pick_owner(5, ACCOUNTS, owned, active_id64=BORROWER).account_name == "owner_acc"
    assert pick_owner(5, ACCOUNTS, {OTHER: [5]}).account_name == "other_acc"


def test_family_shared_game_has_no_owner_among_borrowers():
    # GetOwnedGames leaves borrowed games out: the borrower never appears as owner even while signed in.
    assert pick_owner(7, ACCOUNTS, {OWNER: [1]}, active_id64=BORROWER) is None


def test_installed_by_an_account_not_remembered_keeps_its_id():
    from steam_account_manager.client import InstalledSteamGame
    game = InstalledSteamGame(40, "Delta", "x", "y", "76561198999999999", 0, True)
    table = ownership_table(ACCOUNTS, [game], {OWNER: [41]})
    assert table[40] == {"owner_id64": "76561198999999999", "owner_name": "", "owner_persona": "", "remembered": False, "installed": True, "size_bytes": 0}
    assert table[41]["owner_name"] == "owner_acc" and not table[41]["installed"]


def _server(answers: dict, calls: list | None = None, private=()):
    def opener(request, timeout):
        body = json.loads(request.data)
        if calls is not None:
            calls.append((request.full_url, body["steam_ids"]))
        return io.BytesIO(json.dumps({"accounts": {i: answers.get(i, []) for i in body["steam_ids"]},
                                      "private": [i for i in body["steam_ids"] if i in private], "errors": {}}).encode())
    return opener


def test_fetch_owned_games_asks_the_gameaccess_server_in_batches():
    calls = []
    ids = [str(76561198000000100 + n) for n in range(120)]
    result = fetch_owned_games(SERVER + "/", ids, _server({ids[0]: [{"app_id": 10, "name": "Alpha"}]}, calls, private={ids[1]}))
    assert [len(batch) for _, batch in calls] == [50, 50, 20] and calls[0][0] == SERVER + "/steam/owned-games"
    assert result["accounts"][ids[0]] == [{"app_id": 10, "name": "Alpha"}] and result["private"] == [ids[1]]
    with pytest.raises(ValueError):
        fetch_owned_games("file:///etc", ids, _server({}))


# -- switching ------------------------------------------------------------------------------------------
class FakeSteam:
    def __init__(self, active=0, running=True, signs_in=True):
        self.active_id, self.is_running, self.signs_in, self.calls = active, running, signs_in, []

    def switcher(self):
        clock = iter(range(0, 100000))
        return SteamSwitcher(Path("steam.exe"), Log(), active=lambda: self.active_id, running=lambda: self.is_running,
                             auto_login=self.auto_login, start=self.start, sleep=lambda s: None, clock=lambda: next(clock))

    def auto_login(self, name):
        self.calls.append(("auto_login", name))
        self.chosen = name

    def start(self, *args):
        self.calls.append(("start", *args))
        if args == ("-shutdown",):
            self.is_running = False
        else:
            self.is_running = True
            if self.signs_in:
                self.active_id = {"owner_acc": 39734273, "other_acc": 39734274}[self.chosen]


def test_no_switch_when_the_owner_is_signed_in():
    steam = FakeSteam(active=39734273)
    assert steam.switcher().ensure_account(39734273, "owner_acc") == {"switched": False, "account": "owner_acc"}
    assert steam.calls == []


def test_switch_closes_steam_chooses_the_account_and_waits_for_the_login():
    steam = FakeSteam(active=1)
    assert steam.switcher().ensure_account(39734273, "owner_acc")["switched"]
    assert steam.calls == [("start", "-shutdown"), ("auto_login", "owner_acc"), ("start",)]


def test_switch_starts_a_closed_steam_without_shutdown():
    steam = FakeSteam(active=0, running=False)
    steam.switcher().ensure_account(39734273, "owner_acc")
    assert steam.calls == [("auto_login", "owner_acc"), ("start",)]


def test_switch_fails_clearly_when_steam_asks_for_the_password():
    steam = FakeSteam(active=1, signs_in=False)
    with pytest.raises(RuntimeError, match="contraseña"):
        steam.switcher().ensure_account(39734273, "owner_acc", login_timeout=5)


# -- the manager and the library ------------------------------------------------------------------------
@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.delenv("GAMEACCESS_LAUNCHER_DATA", raising=False)
    monkeypatch.setattr(steam_manager_module, "active_id64", lambda: OWNER)
    root = _steam(tmp_path)
    launcher = tmp_path / "launcher"
    launcher.mkdir()
    storage = DigitalGameStorage(launcher)
    started = []
    monkeypatch.setattr(steam_manager_module.os, "startfile", started.append, raising=False)
    switched = FakeSteam(active=39734273)
    steam = SteamAccountManager(launcher, steam_root=root, logger=Log(), switcher=switched.switcher())
    return steam, storage, started, switched


def test_only_remembered_accounts_and_their_games(setup):
    steam, storage, *_ = setup
    assert [a.account_name for a in steam.accounts()] == ["owner_acc", "other_acc"]
    assert steam.public_settings() == {"auto_import": True, "switch_accounts": True}
    assert steam.save_settings({"auto_import": False, "api_key": "x"}) == {"auto_import": False, "switch_accounts": True}
    steam.save_settings({"auto_import": True})
    result = GameLibraryManager(storage, steam=steam).steam_sync()
    assert 40 not in {g["app_id"] for g in result["linked"]} and storage.linked.get(40) is None


def test_sync_links_installed_games_once_and_skips_unfinished_hidden_and_own(setup):
    steam, storage, *_ = setup
    library = GameLibraryManager(storage, steam=steam)
    result = library.steam_sync()
    assert sorted(g["app_id"] for g in result["linked"]) == [10, 20]
    assert {g["app_id"]: g["owner_name"] for g in result["linked"]} == {10: "owner_acc", 20: "other_acc"}
    assert storage.linked.get(10)["kind"] == "steam"
    assert library.steam_sync()["linked"] == []
    storage.uninstall(20, "Beta")                       # the user takes it out of the library
    assert 20 in storage.linked.hidden()
    assert library.steam_sync()["linked"] == []


def test_owned_games_not_installed_become_library_rows_without_network(setup, monkeypatch):
    steam, storage, *_ = setup
    calls = []
    steam.opener = _server({OWNER: [{"app_id": 10, "name": "Alpha"}, {"app_id": 50, "name": "Epsilon"}]}, calls, private={OTHER})
    library = GameLibraryManager(storage, steam=steam)
    library.steam_sync(refresh=True, api_url=SERVER)
    assert calls == [(SERVER + "/steam/owned-games", [OWNER, OTHER])]          # never the account Steam does not remember
    assert steam.status()["accounts"][1]["private"] is True
    steam.opener = lambda request, timeout: (_ for _ in ()).throw(AssertionError("the library list must not fetch"))
    rows = {g["app_id"]: g for g in library.list_games(with_sizes=False)}
    assert rows[50]["state"] == "steam_owned" and not rows[50]["installed"] and rows[50]["link_kind"] == "steam"
    assert rows[50]["steam_owner"]["account"] in ("owner_acc", "other_acc")
    assert rows[10]["steam_owner"] == {"id64": OWNER, "account": "owner_acc", "persona": 'Owner "Big" One', "remembered": True}
    assert library.list_games()[0]["size_bytes"] in (1234, None) and {g["app_id"]: g["size_bytes"] for g in library.list_games()}[10] == 1234
    assert library.batch("repair", [50])[0]["ok"] is False
    assert library.batch("uninstall", [50]) == [{"app_id": 50, "ok": True}]
    assert 50 not in {g["app_id"] for g in library.list_games(with_sizes=False)}


def test_a_steam_game_uninstalled_in_steam_waits_to_be_installed_again(setup):
    steam, storage, *_ = setup
    library = GameLibraryManager(storage, steam=steam)
    library.steam_sync()
    (Path(storage.linked.get(20)["path"])).rmdir()
    (Path(storage.linked.get(20)["path"]).parents[1] / "appmanifest_20.acf").unlink()
    steam.cache.mkdir(parents=True, exist_ok=True)
    steam.cache.joinpath("owned.json").write_text(json.dumps({"fetched_at": 9e12, "accounts": {OWNER: [], OTHER: [{"app_id": 20, "name": "Beta"}]}}))
    row = next(g for g in library.list_games(with_sizes=False) if g["app_id"] == 20)
    assert row["state"] == "steam_owned" and row["issues"] == [] and row["steam_owner"]["account"] == "other_acc"


def test_play_switches_to_the_owner_then_runs_the_game_through_steam(setup):
    steam, storage, started, switched = setup
    GameLibraryManager(storage, steam=steam).steam_sync()
    outcome = run_linked("play", storage.linked.get(20), storage.linked, Log(), steam=steam)
    assert switched.calls == [("start", "-shutdown"), ("auto_login", "other_acc"), ("start",)]
    assert started == ["steam://rungameid/20"] and outcome["steam_owner"] == "other_acc"
    steam.save_settings({"switch_accounts": False})
    switched.calls.clear()
    run_linked("play", storage.linked.get(10), storage.linked, Log(), steam=steam)
    assert switched.calls == [] and started[-1] == "steam://rungameid/10"


def test_install_hands_the_game_to_steam(setup):
    steam, _, started, _ = setup
    assert steam.install(50) == {"command": "steam://install/50"}
    assert started == ["steam://install/50"]


def test_no_steam_means_nothing_to_import(tmp_path, monkeypatch):
    monkeypatch.delenv("GAMEACCESS_LAUNCHER_DATA", raising=False)
    steam = SteamAccountManager(tmp_path, steam_root=False, logger=Log())
    assert steam.status()["found"] is False and steam.accounts() == []
    storage = DigitalGameStorage(tmp_path)
    assert GameLibraryManager(storage, steam=steam).steam_sync() == {"found": False, "linked": [], "owned": []}


def test_steam_running_reads_tasklist_in_any_code_page(monkeypatch):
    import subprocess
    from steam_account_manager import switch
    monkeypatch.setattr(switch.os, "name", "nt")
    answers = iter([bytes([73, 78, 70, 79, 0xE0, 78]) + b": no hay tareas", b"steam.exe   1234 Console   1   90.000 KB"])
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, next(answers), b""))
    assert switch.steam_running() is False
    assert switch.steam_running() is True


def test_uninstall_deletes_a_steam_game_without_its_account_and_closes_steam_first(setup):
    steam, storage, _, switched = setup
    library = GameLibraryManager(storage, steam=steam)
    library.steam_sync()
    steamapps = Path(storage.linked.get(20)["path"]).parents[1]
    (steamapps / "common" / "Beta" / "game.exe").write_bytes(b"x")
    _write(steamapps / "workshop" / "content" / "20" / "mod.pak", "x")
    _write(steamapps / "workshop" / "appworkshop_20.acf", "x")
    _write(steamapps / "shadercache" / "20" / "cache.bin", "x")
    switched.is_running = True
    assert library.batch("steam_uninstall", [20]) == [{"app_id": 20, "ok": True, "folder": str(steamapps / "common" / "Beta"), "freed_bytes": 1234}]
    assert switched.calls == [("start", "-shutdown")]
    assert not (steamapps / "common" / "Beta").exists() and not (steamapps / "appmanifest_20.acf").exists()
    assert not (steamapps / "workshop" / "content" / "20").exists() and not (steamapps / "workshop" / "appworkshop_20.acf").exists()
    assert not (steamapps / "shadercache" / "20").exists()
    assert (steamapps / "common" / "Gamma").is_dir() and (steamapps / "appmanifest_30.acf").is_file()   # the other games stay
    assert storage.linked.get(20) is None and 20 not in storage.linked.hidden()     # still offered to install again


def test_steam_uninstall_only_for_installed_steam_games(setup):
    steam, storage, *_ = setup
    library = GameLibraryManager(storage, steam=steam)
    library.steam_sync()
    assert library.batch("steam_uninstall", [99])[0] == {"app_id": 99, "ok": False, "error": "No es un juego de Steam instalado."}
    with pytest.raises(ValueError, match="no tiene instalado"):
        steam.uninstall(99)
