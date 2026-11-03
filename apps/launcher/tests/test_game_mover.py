"""A linked game moved into the library shows its progress like a freeze, can be cancelled, and a move cut short by a
closed app is put right on the next start."""
import json
import os

from game_library_manager.mover import move_folder
from game_library_manager.freeze_control import FreezeCancelled
from game_library_manager.storage import DigitalGameStorage
from game_library_manager import GameLibraryManager


class Recorder:
    def __init__(self):
        self.events, self.steps, self.shares, self.size = [], [], [], 0
    def total(self, size): self.size = size
    def step(self, name): self.steps.append(name)
    def advance(self, share, done=None, file=None): self.shares.append(share)
    def event(self, kind, **values): self.events.append(kind)


def game(folder, sizes=(3_000_000, 20_000_000)):
    (folder / "data").mkdir(parents=True)
    for index, size in enumerate(sizes):
        (folder / ("game.exe" if index == 0 else "data/pack.bin")).write_bytes(os.urandom(size))
    return sum(sizes)


def test_on_the_same_disk_it_is_only_renamed(tmp_path):
    source, target, progress = tmp_path / "Eta", tmp_path / "lib" / "8-Eta", Recorder()
    game(source)
    target.parent.mkdir()
    assert move_folder(source, target, progress)["renamed"] is True
    assert not source.exists() and (target / "data" / "pack.bin").is_file()
    assert progress.events[-1] == "renamed" and progress.shares[-1] == 1.0


def test_to_another_disk_each_byte_copied_moves_the_bar_and_the_original_goes_last(tmp_path, monkeypatch):
    monkeypatch.setattr(os, "rename", lambda *a: (_ for _ in ()).throw(OSError(17, "different disk")))
    source, target, progress = tmp_path / "Eta", tmp_path / "lib" / "8-Eta", Recorder()
    total = game(source)
    result = move_folder(source, target, progress)
    assert result == {"renamed": False, "bytes": total, "files": 2, "resumed_bytes": 0}
    assert not source.exists() and (target / "data" / "pack.bin").stat().st_size == 20_000_000
    assert progress.steps == ["move", "clear"] and progress.size == total
    assert len(progress.shares) > 3 and progress.shares == sorted(progress.shares)
    assert {"files", "copied"} <= set(progress.events)


def test_a_cancel_drops_the_half_made_copy_and_never_touches_the_original(tmp_path, monkeypatch):
    monkeypatch.setattr(os, "rename", lambda *a: (_ for _ in ()).throw(OSError(17, "different disk")))
    source, target = tmp_path / "Eta", tmp_path / "lib" / "8-Eta"
    game(source)
    calls = []
    def checkpoint():
        calls.append(1)
        if len(calls) > 2:
            raise FreezeCancelled("cancelado")
    try:
        move_folder(source, target, Recorder(), checkpoint)
    except FreezeCancelled:
        pass
    assert not target.exists() and (source / "data" / "pack.bin").stat().st_size == 20_000_000


def test_the_library_move_writes_its_progress_file_and_log_and_a_cancel_leaves_it_linked(tmp_path, monkeypatch):
    storage = DigitalGameStorage(tmp_path)
    lib = GameLibraryManager(storage)
    source = tmp_path / "outside" / "Eta"
    game(source)
    storage.linked.link(8, "Eta", str(source))
    result = lib.batch("linked_move", [8])[0]
    assert result["ok"] and result["seconds"] >= 0, result
    state = json.loads((lib.freezer.records / "8.progress.json").read_text(encoding="utf-8"))
    assert state["action"] == "move" and state["finished"] and state["ok"] and state["percent"] == 100.0
    assert state["steps"] == ["move", "clear", "adopt"] and state["events"][-1]["kind"] == "done"
    moved = storage.folder(8, "Eta")
    assert "movido a la biblioteca en" in (moved / "gameaccess-log.txt").read_text(encoding="utf-8")

    # A second game, cancelled from the app while it copies (the cancel file freeze_control looks at).
    monkeypatch.setattr(os, "rename", lambda *a: (_ for _ in ()).throw(OSError(17, "different disk")))
    other = tmp_path / "outside" / "Theta"
    game(other)
    storage.linked.link(9, "Theta", str(other))
    import game_library_manager.mover as mover
    real_open, opened = open, []
    def cancelling_open(path, mode="r", *args, **kwargs):
        if "w" in mode and not opened:
            opened.append(path)
            (lib.freezer.records / "9.cancel").write_text("", encoding="utf-8")
        return real_open(path, mode, *args, **kwargs)
    monkeypatch.setattr(mover, "open", cancelling_open, raising=False)
    cancelled = lib.batch("linked_move", [9])[0]
    assert cancelled == {"app_id": 9, "ok": False, "cancelled": True}
    assert other.is_dir() and storage.linked.get(9)["path"] == str(other.resolve())
    assert not any(p.name.startswith("9-") for p in storage.root.iterdir())
    state = json.loads((lib.freezer.records / "9.progress.json").read_text(encoding="utf-8"))
    assert state["finished"] and state["cancelled"]


def test_a_resumed_copy_skips_whole_files_and_goes_on_from_the_end_of_the_half_copied_one(tmp_path, monkeypatch):
    monkeypatch.setattr(os, "rename", lambda *a: (_ for _ in ()).throw(OSError(17, "different disk")))
    source, target, progress = tmp_path / "Eta", tmp_path / "lib" / "8-Eta", Recorder()
    total = game(source)
    # What a copy cut short left: the small file whole, the big one half written.
    import shutil
    (target / "data").mkdir(parents=True)
    shutil.copy2(source / "game.exe", target / "game.exe")
    (target / "data" / "pack.bin").write_bytes((source / "data" / "pack.bin").read_bytes()[:12_000_000])
    result = move_folder(source, target, progress, resume=True)
    assert result["resumed_bytes"] == 3_000_000 + 12_000_000 and result["bytes"] == total
    assert (target / "data" / "pack.bin").stat().st_size == 20_000_000 and not source.exists()
    assert "resumed" in progress.events


def test_a_half_copied_file_that_does_not_match_is_copied_again(tmp_path):
    from game_library_manager.mover import resume_offset
    original, copy = tmp_path / "a.bin", tmp_path / "b.bin"
    original.write_bytes(os.urandom(5_000_000))
    copy.write_bytes(original.read_bytes()[:3_000_000])
    assert resume_offset(original, copy) == 3_000_000
    copy.write_bytes(b"x" * 3_000_000)
    assert resume_offset(original, copy) == 0


def cut_move(tmp_path, step="move"):
    """A library whose move of game 8 was cut by a closed app while copying, with 4 MB copied."""
    storage = DigitalGameStorage(tmp_path)
    lib = GameLibraryManager(storage)
    source, target = tmp_path / "outside" / "Eta", storage.root / "8-Eta"
    game(source)
    (target / "data").mkdir(parents=True)
    (target / "game.exe").write_bytes((source / "game.exe").read_bytes()[:4_000_000] if (source / "game.exe").stat().st_size > 4_000_000 else (source / "game.exe").read_bytes())
    lib.freezer.records.mkdir(parents=True, exist_ok=True)
    (lib.freezer.records / "8.progress.json").write_text(json.dumps({
        "action": "move", "pid": 999999, "step": step, "percent": 40, "finished": False, "done_bytes": 4_000_000,
        "folder": str(source), "source": str(source), "target": str(target), "name": "Eta", "executable": ""}), encoding="utf-8")
    return storage, lib, source, target


def test_a_move_cut_by_a_closed_app_keeps_its_copy_and_can_go_on(tmp_path, monkeypatch):
    # Another disk for the mover only (adopting renames the folder to "-ready" with the real os.rename).
    import types, game_library_manager.mover as mover
    monkeypatch.setattr(mover, "os", types.SimpleNamespace(rename=lambda *a: (_ for _ in ()).throw(OSError(17, "different disk"))))
    storage, lib, source, target = cut_move(tmp_path)
    [entry] = lib.freezer.recover()
    assert entry["action"] == "move" and entry["outcome"] == "resumable"
    # Meanwhile the game plays from where it was, and the library says the move is pending.
    assert target.is_dir() and storage.linked.get(8)["path"] == str(source.resolve())
    listed = next(g for g in lib.list_games(with_sizes=False) if g["app_id"] == 8)
    assert listed["move_pending"]["percent"] == 40
    result = lib.batch("linked_move_resume", [8])[0]
    assert result["ok"], result
    assert result["resumed_bytes"] > 0 and not source.exists() and storage.linked.get(8) is None
    assert (storage.folder(8, "Eta") / "data" / "pack.bin").stat().st_size == 20_000_000


def test_the_half_made_copy_of_a_cut_move_can_be_discarded(tmp_path):
    storage, lib, source, target = cut_move(tmp_path)
    lib.freezer.recover()
    assert lib.batch("linked_move_discard", [8])[0] == {"app_id": 8, "ok": True, "discarded": True}
    assert not target.exists() and source.is_dir() and storage.linked.get(8)
    assert "move_pending" not in next(g for g in lib.list_games(with_sizes=False) if g["app_id"] == 8)


def test_a_move_cut_after_the_copy_ends_by_itself(tmp_path):
    storage, lib, source, target = cut_move(tmp_path, step="clear")
    [entry] = lib.freezer.recover()
    assert entry["outcome"] == "completed" and not source.exists() and target.is_dir()
