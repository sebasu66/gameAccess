import json
import sys
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from game_execution_manager.execution_profile import load_profile, apply_before_play, profile_path, validate_profile

def test_missing_plugin_profile_keeps_generic_play_available(tmp_path):
    assert load_profile(tmp_path,10)["beforePlay"] == []

def test_profile_ini_step_is_idempotent_and_preserves_other_settings(tmp_path):
    ini=tmp_path/"settings.ini"
    ini.write_text("[Game]\nLanguage=russian\nMode=normal\n[Other]\nLanguage=french\n",encoding="utf-8")
    profile={"archivePasswords":["private-fixture"],"beforePlay":[{"type":"ini-set","glob":"settings.ini","section":"Game","key":"Language","value":"english"}]}
    apply_before_play(tmp_path,profile)
    first=ini.read_text()
    apply_before_play(tmp_path,profile)
    assert ini.read_text()==first
    assert "Language=english" in first and "Mode=normal" in first and "Language=french" in first

def test_profile_does_not_create_unknown_provider_sections(tmp_path):
    file=tmp_path/"a.ini";file.write_text("[Game]\nTest=yes")
    apply_before_play(tmp_path,{"beforePlay":[{"type":"ini-set","glob":"*.ini","section":"Unknown","key":"key","value":"value"}]})
    assert file.read_text()=="[Game]\nTest=yes"

@pytest.mark.parametrize("step",[{"type":"run","executable":"../outside.exe"},{"type":"ini-set","glob":"../*.ini","section":"a","key":"b","value":"c"},{"type":"shell","command":"echo unwanted"}])
def test_profile_cannot_escape_game_folder_or_run_shell(tmp_path,step):
    with pytest.raises(ValueError):apply_before_play(tmp_path,{"beforePlay":[step]})

def test_profile_passwords_loaded_from_local_file_without_server(tmp_path):
    path=profile_path(tmp_path,10);path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"archivePasswords":["fixture"],"beforePlay":[]}))
    assert load_profile(tmp_path,10)["archivePasswords"]==["fixture"]


def test_form_fields_default_and_validate(tmp_path):
    profile = load_profile(tmp_path, 5)
    assert profile["decompressEachRun"] is False and profile["decompressFile"] == ""
    assert profile["executablePatterns"] == [] and profile["runAsAdmin"] is False
    for bad in ({"decompressFile": "../x.zip"}, {"decompressFile": "C:/x.zip"}, {"executablePatterns": ["..\\a.exe"]},
                {"executablePatterns": [""]}, {"runAsAdmin": "yes"}, {"decompressEachRun": 1}):
        with pytest.raises(ValueError):
            validate_profile(bad)


def test_executable_patterns_come_first_in_profile_order(tmp_path):
    from digital_process_runner import DigitalProcessRunner
    for rel in ("Game/Other.exe", "Game/My Game Launcher.exe", "Game/MyGame.exe", "Game/unins000.exe"):
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_bytes(b"x")
    runner = DigitalProcessRunner.__new__(DigitalProcessRunner)
    ordered = [exe.name for exe, _ in runner.get_candidates(tmp_path.resolve(), "My Game", "", ["*LAUNCHER*.EXE", "GAMENAME.EXE"])]
    assert ordered[:2] == ["My Game Launcher.exe", "MyGame.exe"] and "unins000.exe" not in ordered
