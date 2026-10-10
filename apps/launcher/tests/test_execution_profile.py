import json
import sys
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from execution_profile import load_profile, apply_before_play, profile_path, validate_profile

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
