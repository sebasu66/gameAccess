import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import launcher_data
from game_library_manager.preferences import DigitalPreferences


def test_a_checkout_keeps_its_state_and_folders_inside_the_launcher(tmp_path, monkeypatch):
    monkeypatch.delenv("GAMEACCESS_LAUNCHER_DATA", raising=False)
    settings = DigitalPreferences(tmp_path).load()
    assert launcher_data.data_dir(tmp_path) == tmp_path.resolve()
    assert settings["games_root"] == str(tmp_path.resolve() / "games")
    assert settings["temporary_root"] == str(tmp_path.resolve() / ".cache" / "digital_transfers")


def test_an_installed_app_uses_the_user_data_folder_and_the_installer_folders(tmp_path, monkeypatch):
    data = tmp_path / "LocalAppData" / "gameAccess" / "launcher"
    monkeypatch.setenv("GAMEACCESS_LAUNCHER_DATA", str(data))
    monkeypatch.setenv("SystemDrive", "D:")
    monkeypatch.setattr(launcher_data, "_user_downloads", lambda: tmp_path / "Downloads")
    monkeypatch.setattr(launcher_data, "_installer_choice", lambda name: "")
    preferences = DigitalPreferences(tmp_path / "Program Files" / "gameAccess" / "runtime" / "launcher")
    assert preferences.path == data / ".cache" / "digital-settings.json"
    assert preferences.load()["games_root"] == str(Path("D:\\") / "juegos_GameAccess")
    assert preferences.load()["temporary_root"] == str(tmp_path / "Downloads" / "GameAccessDownloads")
    monkeypatch.setattr(launcher_data, "_installer_choice", {"GamesDir": r"E:\Juegos", "DownloadsDir": r"E:\Bajadas"}.get)
    assert preferences.load()["games_root"] == r"E:\Juegos"
    assert preferences.load()["temporary_root"] == r"E:\Bajadas"
