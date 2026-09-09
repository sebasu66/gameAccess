from pathlib import Path

import pool_sync


def test_library_discovery_prefers_config_vdf_and_preserves_indices(monkeypatch, tmp_path: Path):
    root = tmp_path / "Steam"
    config_vdf = root / "config" / "libraryfolders.vdf"
    legacy_vdf = root / "steamapps" / "libraryfolders.vdf"
    calls: list[Path] = []

    def fake_read(path: Path):
        calls.append(path)
        if path == config_vdf:
            return {
                "libraryfolders": {
                    "0": {"path": str(root)},
                    "3": {"path": str(tmp_path / "Games")},
                }
            }
        raise AssertionError(f"legacy VDF should not be read after config succeeds: {path}")

    monkeypatch.setattr(pool_sync, "_read_vdf", fake_read)
    monkeypatch.setattr(pool_sync, "_library_space", lambda _path: (123, 456))

    folders = pool_sync._steam_library_folders(root)

    assert calls == [config_vdf]
    assert [folder["index"] for folder in folders] == [0, 3]
    assert folders[1]["free_bytes"] == 123
    assert folders[1]["total_bytes"] == 456


def test_library_discovery_falls_back_to_steamapps_vdf(monkeypatch, tmp_path: Path):
    root = tmp_path / "Steam"
    config_vdf = root / "config" / "libraryfolders.vdf"
    legacy_vdf = root / "steamapps" / "libraryfolders.vdf"
    calls: list[Path] = []

    def fake_read(path: Path):
        calls.append(path)
        if path == config_vdf:
            raise OSError("not present")
        if path == legacy_vdf:
            return {"libraryfolders": {"2": {"path": str(tmp_path / "LegacyGames")}}}
        raise AssertionError(path)

    monkeypatch.setattr(pool_sync, "_read_vdf", fake_read)
    monkeypatch.setattr(pool_sync, "_library_space", lambda _path: (None, None))

    folders = pool_sync._steam_library_folders(root)

    assert calls == [config_vdf, legacy_vdf]
    assert folders == [{
        "index": 2,
        "path": str(tmp_path / "LegacyGames"),
        "label": str(tmp_path / "LegacyGames"),
        "free_bytes": None,
        "total_bytes": None,
    }]


def test_library_discovery_deduplicates_paths_without_renumbering(monkeypatch, tmp_path: Path):
    root = tmp_path / "Steam"

    monkeypatch.setattr(
        pool_sync,
        "_read_vdf",
        lambda _path: {
            "libraryfolders": {
                "0": {"path": str(root)},
                "1": {"path": str(root) + "/"},
                "4": {"path": str(tmp_path / "Other")},
            }
        },
    )
    monkeypatch.setattr(pool_sync, "_library_space", lambda _path: (10, 20))

    folders = pool_sync._steam_library_folders(root)

    assert [folder["index"] for folder in folders] == [0, 4]
