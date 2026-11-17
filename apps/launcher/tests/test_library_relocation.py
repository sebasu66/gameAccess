from pathlib import Path
from game_library_manager import GameLibraryManager
from game_library_manager.preferences import DigitalPreferences
from game_library_manager.storage import DigitalGameStorage


def library_in(tmp_path):
    """Two games in the first games folder: one ready, one whose download did not finish."""
    launcher = tmp_path / "launcher"
    launcher.mkdir()
    old = tmp_path / "old_games"
    DigitalPreferences(launcher).save({"games_root": str(old), "temporary_root": str(tmp_path / "tmp")})
    storage = DigitalGameStorage(launcher)
    ready = storage.set_status(1, "Alpha", "ready") if storage.register(1, "Alpha") else None
    (ready / "Alpha.exe").write_bytes(b"x" * 100)
    unfinished = storage.set_status(2, "Beta", "downloading") if storage.register(2, "Beta") else None
    (unfinished / "part.bin").write_bytes(b"y" * 10)
    return launcher, old


def change_root(launcher, new):
    preferences = DigitalPreferences(launcher)
    preferences.save({**preferences.load(), "games_root": str(new)})
    storage = DigitalGameStorage(launcher)
    return storage, GameLibraryManager(storage)


def test_changing_the_games_folder_moves_every_game_and_leaves_one_folder(tmp_path):
    launcher, old = library_in(tmp_path)
    new = tmp_path / "GA_Juegos"
    storage, lib = change_root(launcher, new)
    plan = lib.relocate_plan(str(new))
    assert {g["app_id"] for g in plan["games"]} == {1, 2} and plan["room"] and all(g["fits"] for g in plan["games"])
    for game in plan["games"]:
        assert lib.relocate(game["app_id"], str(new), "move")["ok"]
    finished = lib.relocate_finish()
    assert finished["settings"]["previous_roots"] == [] and finished["left"] == []
    storage = DigitalGameStorage(launcher)
    assert storage.roots == [new.resolve()]
    assert {p.name for p in new.iterdir()} == {"1-Alpha-ready", "2-Beta-downloading"}
    assert storage.folder(1, "Alpha") == new.resolve() / "1-Alpha-ready"


def test_not_moving_links_the_ready_games_where_they_are_and_still_moves_unfinished_ones(tmp_path):
    launcher, old = library_in(tmp_path)
    new = tmp_path / "GA_Juegos"
    storage, lib = change_root(launcher, new)
    assert lib.relocate(1, str(new), "link") == {"app_id": 1, "ok": True, "mode": "link"}
    assert lib.relocate(2, str(new), "link")["mode"] == "move"       # an unfinished download cannot be linked
    lib.relocate_finish()
    storage = DigitalGameStorage(launcher)
    games = {g["app_id"]: g for g in GameLibraryManager(storage).list_games(with_sizes=False)}
    assert storage.roots == [new.resolve()]
    assert games[1]["linked"] and games[1]["link_kind"] == "folder" and Path(games[1]["folder"]) == (old / "1-Alpha-ready").resolve()
    assert sum(1 for g in GameLibraryManager(storage).list_games(with_sizes=False) if g["app_id"] == 1) == 1


def test_a_game_that_could_not_move_keeps_its_old_folder_listed(tmp_path, monkeypatch):
    launcher, old = library_in(tmp_path)
    new = tmp_path / "GA_Juegos"
    storage, lib = change_root(launcher, new)
    monkeypatch.setattr("game_library_manager.relocate.fits", lambda target, longest: False)
    assert not lib.relocate(1, str(new), "move")["ok"]
    assert lib.relocate_finish()["left"] == [str(old.resolve())]
    assert {g["app_id"] for g in GameLibraryManager(DigitalGameStorage(launcher)).list_games(with_sizes=False)} >= {1, 2}
