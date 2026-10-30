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
    assert result == {"renamed": False, "bytes": total, "files": 2}
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


def test_a_move_cut_by_a_closed_app_goes_back_to_linked(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    lib = GameLibraryManager(storage)
    source, target = tmp_path / "outside" / "Eta", storage.root / "8-Eta"
    game(source)
    (target / "data").mkdir(parents=True)
    (target / "game.exe").write_bytes(b"half")
    lib.freezer.records.mkdir(parents=True, exist_ok=True)
    (lib.freezer.records / "8.progress.json").write_text(json.dumps({
        "action": "move", "pid": 999999, "step": "move", "percent": 40, "finished": False,
        "folder": str(source), "source": str(source), "target": str(target), "name": "Eta", "executable": ""}), encoding="utf-8")
    [entry] = lib.freezer.recover()
    assert entry["action"] == "move" and entry["outcome"] == "restored"
    assert not target.exists() and storage.linked.get(8)["path"] == str(source.resolve())
