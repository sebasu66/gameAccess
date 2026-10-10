import json
import logging
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from digital_storage import DigitalGameStorage
from digital_process_runner import DigitalProcessRunner
from digital_preferences import DigitalPreferences
from digital_game_options import DigitalGameOptions, repair_language, parse_arguments

class DigitalOptionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.launcher = Path(self.temp.name) / "launcher"
        self.launcher.mkdir()
        self.storage = DigitalGameStorage(self.launcher)
        self.folder = self.storage.register(12, "Game")
        (self.folder / "game.exe").write_bytes(b"game fixture")

    def test_changing_paths_keeps_previous_installation_discoverable(self):
        new = self.launcher.parent / "new-games"
        settings = self.storage.preferences.load()
        settings["games_root"] = str(new)
        self.storage.preferences.save(settings)
        storage = DigitalGameStorage(self.launcher)
        self.assertEqual(storage.folder(12, "Renamed"), self.folder)
        self.assertTrue(storage.snapshot([{"id":12, "name":"Game"}])["12"]["installed"])
        self.assertEqual(storage.register(13, "Next").parent, new)
        storage.uninstall(12, "Game")
        self.assertFalse(self.folder.exists())

    def test_root_and_overlapping_paths_are_rejected(self):
        settings = self.storage.preferences.load()
        for games, temporary in [(Path(self.launcher.anchor), self.launcher / "temp"),
                                  (self.launcher, self.launcher / "temp"),
                                  (self.folder, self.folder / "temp")]:
            with self.assertRaises(ValueError):
                self.storage.preferences.save({**settings,"games_root":str(games),"temporary_root":str(temporary)})

    def test_manual_language_repair_preserves_encoding_comments_and_original_backup(self):
        ini = self.folder / "user.ini"
        original = "[Game]\r\nLanguage = russian ; comment\r\nOther=value\r\n"
        ini.write_bytes(original.encode("utf-16"))
        result = repair_language(self.folder, "english", logging.getLogger("test"))
        self.assertEqual(result["changed"], ["user.ini"])
        self.assertEqual(ini.read_bytes().decode("utf-16"), original.replace("russian","english"))
        backup = ini.with_name("user.ini.gameaccess-language.bak")
        self.assertEqual(backup.read_bytes(), original.encode("utf-16"))
        repair_language(self.folder, "spanish", logging.getLogger("test"))
        self.assertEqual(backup.read_bytes(), original.encode("utf-16"))
        self.assertEqual(repair_language(self.folder,"spanish",logging.getLogger("test"))["changed"],[])

    def test_language_key_forms_and_unrelated_ini_are_preserved(self):
        ini = self.folder / "steam_emu.ini"
        ini.write_text('Language="ru_RU"\nUserName=RussianUser\nLocale=ru-RU\n', encoding="utf-8")
        repair_language(self.folder,"spanish",logging.getLogger("test"))
        self.assertEqual(ini.read_text(), 'Language="es_ES"\nUserName=RussianUser\nLocale=es-ES\n')

    def test_custom_executable_and_arguments_keep_restore_and_fixes(self):
        exe = self.folder / "bin" / "custom.exe"
        exe.parent.mkdir()
        exe.write_bytes(b"game fixture")
        options = DigitalGameOptions(self.storage)
        options.save(12,"Game",{"executable":"bin/custom.exe","arguments":'-name "Two Words" -windowed',"language":"english"})
        runner = DigitalProcessRunner(self.storage)
        with patch("digital_process_runner.DigitalArchiveBackup.restore") as restore, \
             patch.object(runner,"patch_onlinefix_popup") as popup, \
             patch.object(runner,"patch_crack_language") as language, \
             patch("digital_process_runner.subprocess.Popen") as spawn:
            spawn.return_value.pid=123
            spawn.return_value.returncode=0
            result=runner.run("play",12,"Game")
            self.assertTrue(result["ok"],result)
            restore.assert_called_once()
            popup.assert_called_once_with(self.folder)
            language.assert_called_once_with(self.folder,"english")
            self.assertEqual(spawn.call_args.args[0], [str(exe),"-name","Two Words","-windowed"])

    def test_automatic_discovery_remains_the_default(self):
        runner=DigitalProcessRunner(self.storage)
        with patch.object(runner,"get_candidates",return_value=[(self.folder/"game.exe",[])]) as discover, \
             patch("digital_process_runner.DigitalArchiveBackup.restore"), \
             patch("digital_process_runner.subprocess.Popen") as spawn:
            spawn.return_value.pid=123
            spawn.return_value.returncode=0
            self.assertTrue(runner.run("play",12,"Game")["ok"])
            discover.assert_called_once()

    def test_selected_executable_outside_game_is_rejected(self):
        outside = self.launcher / "outside.exe"
        outside.write_bytes(b"fixture")
        with self.assertRaises(ValueError):
            DigitalGameOptions(self.storage).save(12,"Game",{"executable":str(outside)})
        self.assertFalse(DigitalGameOptions(self.storage).path(12).exists())

    def test_administrator_launch_preserves_preparation_and_does_not_fallback_after_uac_cancel(self):
        DigitalGameOptions(self.storage).save(12,"Game",{"executable":"game.exe","administrator":True})
        runner=DigitalProcessRunner(self.storage)
        with patch("digital_process_runner.DigitalArchiveBackup.restore") as restore, \
             patch("digital_process_runner.launch_as_administrator",side_effect=ValueError("Se canceló la autorización de administrador.")) as elevated, \
             patch("digital_process_runner.subprocess.Popen") as spawn:
            result=runner.run("play",12,"Game")
            self.assertFalse(result["ok"])
            self.assertIn("canceló",result["error"])
            restore.assert_called_once()
            elevated.assert_called_once()
            spawn.assert_not_called()

    def test_uninstall_removes_partial_temporary_payload_too(self):
        temporary = Path(self.storage.preferences.load()["temporary_root"]) / "12-Game"
        temporary.mkdir(parents=True)
        (temporary/"unfinished.zip").write_bytes(b"partial")
        self.storage.uninstall(12,"Game")
        self.assertFalse(temporary.exists())
        self.assertFalse(self.folder.exists())

    def test_arguments_use_windows_quoting_without_a_shell(self):
        self.assertEqual(parse_arguments('-name "Two Words" -windowed'),["-name","Two Words","-windowed"])
