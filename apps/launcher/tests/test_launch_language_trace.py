import logging
import tempfile
import unittest
from pathlib import Path

from game_execution_manager.game_options import KEEP_LANGUAGE, effective_language, repair_language, restore_language, supports_language
from game_execution_manager.launch_trace import LaunchTrace, diagnose


class LanguageSupportTests(unittest.TestCase):
    def test_spanish_is_forced_only_into_games_that_ship_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp)
            (game / "data").mkdir()
            (game / "data" / "text_en.pak").write_bytes(b"x")
            self.assertFalse(supports_language(game, "spanish"))
            self.assertTrue(supports_language(game, "english"))
            (game / "data" / "text_es.pak").write_bytes(b"x")
            self.assertTrue(supports_language(game, "spanish"))

    def test_a_dll_named_like_a_language_does_not_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "es.dll").write_bytes(b"x")
            self.assertFalse(supports_language(Path(tmp), "spanish"))

    def test_restore_puts_back_what_a_repair_changed(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp)
            ini = game / "steam_emu.ini"
            ini.write_text("Language=english\n", encoding="utf-8")
            repair_language(game, "spanish", logging.getLogger("t"))
            self.assertIn("spanish", ini.read_text(encoding="utf-8"))
            self.assertEqual(restore_language(game), ["steam_emu.ini"])
            self.assertEqual(ini.read_text(encoding="utf-8"), "Language=english\n")
            self.assertEqual(list(game.glob("*.bak")), [])

    def test_keep_is_a_valid_choice(self):
        self.assertEqual(effective_language({"language": KEEP_LANGUAGE}), KEEP_LANGUAGE)


class TraceTests(unittest.TestCase):
    def test_trace_mirrors_the_logger_and_finishes(self):
        import json
        logger = logging.getLogger("trace-test")
        logger.setLevel(logging.INFO)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "7-progress.json"
            with LaunchTrace(path, logger) as trace:
                logger.info("Resolving executable")
                trace.finish(False, "boom")
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertTrue(data["finished"])
            self.assertEqual(data["error"], "boom")
            self.assertIn("Resolving executable", [line["text"] for line in data["lines"]])

    def test_diagnose_flags_a_missing_marked_executable(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp)
            (game / ".gameaccess_exe").write_text("Game.exe", encoding="utf-8")
            checks = {c["id"]: c for c in diagnose(game, False, False, False)}
            self.assertEqual(checks["antivirus"]["missing"], "Game.exe")
            self.assertFalse(checks["antivirus"]["ok"])


if __name__ == "__main__":
    unittest.main()
