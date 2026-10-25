"""Verify shortcut payloads cannot invoke a game directly or inject commands."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_shortcut as shortcuts

class ShortcutTest(unittest.TestCase):
    def test_names_stay_inside_desktop_and_arguments_are_only_app_ids(self):
        name = shortcuts.shortcut_name(1426210, '../Name: * "Bad"')
        self.assertNotIn("/", name)
        self.assertNotIn("\\", name)
        self.assertTrue(name.endswith("GameAccess 1426210.lnk"))
        for bad in (0, -1, 2**32):
            with self.assertRaises(ValueError):
                shortcuts.shortcut_name(bad, "Fixture")

    @unittest.skipUnless(os.name == "nt", "Windows links")
    def test_real_link_targets_launcher_and_has_no_game_executable_argument(self):
        with tempfile.TemporaryDirectory(prefix="gameaccess-shortcut-") as folder:
            desktop = Path(folder)
            launcher = Path(sys.executable)
            link = shortcuts.create_shortcut(1426210, "Fixture $(Write-Error)", launcher, desktop)
            script = r"""
$data=[Console]::In.ReadToEnd() | ConvertFrom-Json
$link=(New-Object -ComObject WScript.Shell).CreateShortcut($data.path)
@{target=$link.TargetPath;args=$link.Arguments;directory=$link.WorkingDirectory}|ConvertTo-Json -Compress
"""
            result = subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",script],
                input=json.dumps({"path":str(link)}), text=True, capture_output=True, timeout=15,
                creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
            self.assertEqual(result.returncode,0,result.stderr)
            data=json.loads(result.stdout)
            self.assertEqual(Path(data["target"]).resolve(),launcher.resolve())
            self.assertEqual(data["args"],"--launch-game 1426210")
            self.assertEqual(Path(data["directory"]).resolve(),launcher.parent.resolve())


class ShortcutIconTest(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows links")
    def test_link_shows_the_game_icon_but_still_opens_gameaccess(self):
        with tempfile.TemporaryDirectory(prefix="gameaccess-shortcut-") as folder:
            desktop, launcher = Path(folder), Path(sys.executable)
            game_exe = Path(sys.executable).with_name("pythonw.exe") if Path(sys.executable).with_name("pythonw.exe").is_file() else launcher
            link = shortcuts.create_shortcut(1426210, "Fixture", launcher, desktop, icon=game_exe)
            script = r"""
$data=[Console]::In.ReadToEnd() | ConvertFrom-Json
$link=(New-Object -ComObject WScript.Shell).CreateShortcut($data.path)
@{target=$link.TargetPath;icon=$link.IconLocation}|ConvertTo-Json -Compress
"""
            result = subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",script],
                input=json.dumps({"path":str(link)}), text=True, capture_output=True, timeout=15,
                creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
            data = json.loads(result.stdout)
            self.assertEqual(Path(data["target"]).resolve(), launcher.resolve())
            self.assertEqual(data["icon"].lower(), f"{game_exe},0".lower())

    def test_no_game_executable_keeps_the_gameaccess_icon(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(shortcuts.game_icon(999999991, "Nothing here", Path(folder)))
