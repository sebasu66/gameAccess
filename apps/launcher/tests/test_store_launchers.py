import tempfile
import unittest
from pathlib import Path

from game_execution_manager import store_launchers as sl


class StoreLauncherTests(unittest.TestCase):
    def test_the_games_files_say_which_launchers_it_asks_for(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp)
            (game / "bin").mkdir()
            (game / "bin" / "uplay_r2_loader64.dll").write_bytes(b"x")
            (game / ".egstore").mkdir()
            (game / "launcher").mkdir()
            (game / "launcher" / "launcher-settings.json").write_text("{}")
            (game / "EAAntiCheat.GameServiceLauncher.exe").write_bytes(b"x")
            self.assertEqual(sl.needed_by(game), ["epic", "ubisoft", "ea", "paradox"])

    def test_a_plain_game_asks_for_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "game.exe").write_bytes(b"x")
            (Path(tmp) / "EOSSDK-Win64-Shipping.dll").write_bytes(b"x")  # Epic's online services: no launcher needed
            self.assertEqual(sl.needed_by(Path(tmp)), [])

    def test_start_reports_not_installed_running_and_started(self):
        self.assertEqual(sl.start("epic", is_running=lambda _: True), (True, "already running"))
        original = sl.program
        try:
            sl.program = lambda _: None
            ok, why = sl.start("ubisoft", is_running=lambda _: False)
            self.assertFalse(ok)
            self.assertIn("not installed", why)
        finally:
            sl.program = original

    def test_every_launcher_has_a_program_and_a_process(self):
        for launcher, info in sl.LAUNCHERS.items():
            self.assertTrue(info["paths"] and info["processes"] and info["hints"], launcher)


if __name__ == "__main__":
    unittest.main()


class AntiCheatTests(unittest.TestCase):
    def test_the_game_files_say_which_anticheat_it_ships(self):
        from game_execution_manager import anticheat
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp)
            (game / "EasyAntiCheat").mkdir()
            (game / "BEService_x64.exe").write_bytes(b"x")
            self.assertEqual(anticheat.shipped_with(game), ["eac", "battleye"])
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(anticheat.shipped_with(Path(tmp)), [])

    def test_state_picks_the_best_of_its_services(self):
        from game_execution_manager import anticheat
        answers = {"EasyAntiCheat": "missing", "EasyAntiCheat_EOS": "stopped"}
        self.assertEqual(anticheat.state("eac", query=answers.get), "stopped")
        self.assertEqual(anticheat.state("eac", query=lambda _: "missing"), "missing")
        self.assertEqual(anticheat.state("battleye", query=lambda _: "running"), "running")


class RequirementsTests(unittest.TestCase):
    def test_what_a_game_needs_is_detected_merged_and_kept_in_its_profile(self):
        from game_execution_manager import requirements as needs
        from game_execution_manager.execution_profile import validate_profile
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp)
            (game / "steam_api64.dll").write_bytes(b"x")
            (game / "upc_r2_loader64.dll").write_bytes(b"x")
            (game / "EasyAntiCheat").mkdir()
            found = needs.detect(game)
            self.assertEqual(found, {"steam": True, "launchers": ["ubisoft"], "anticheat": ["eac"]})
            # A plugin or the player may add what the files do not show; unknown names are dropped.
            merged = needs.merge({"launchers": ["epic", "nope"]}, found)
            self.assertEqual(merged["launchers"], ["epic", "ubisoft"])
            self.assertEqual(validate_profile({"requires": merged})["requires"], merged)
            self.assertNotIn("requires", validate_profile({"requires": {"launchers": ["nope"]}}))

    def test_a_plain_game_requires_nothing(self):
        from game_execution_manager import requirements as needs
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "game.exe").write_bytes(b"x")
            self.assertIsNone(needs.clean(needs.detect(Path(tmp))))
