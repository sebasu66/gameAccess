import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from digital_storage import DigitalGameStorage, split_folder_name
from digital_process_runner import DigitalProcessRunner


class FolderNameTests(unittest.TestCase):
    def test_status_is_read_after_the_last_dash_and_titles_may_contain_dashes(self):
        self.assertEqual(split_folder_name("620-Portal 2-ready"), (620, "Portal 2", "ready"))
        self.assertEqual(split_folder_name("1-Half-Life 2-ERROR"), (1, "Half-Life 2", "ERROR"))
        self.assertEqual(split_folder_name("1-Half-Life 2"), (1, "Half-Life 2", None))
        self.assertEqual(split_folder_name("7-Anything-downloading"), (7, "Anything", "downloading"))

    def test_only_known_statuses_count_and_the_app_id_must_be_a_prefix(self):
        self.assertEqual(split_folder_name("7-Game-finished"), (7, "Game-finished", None))
        self.assertEqual(split_folder_name("7-ready"), (7, "ready", None))
        self.assertEqual(split_folder_name("Game-ready"), (None, "Game-ready", None))


class FolderStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="digital-status-fixture-")
        self.storage = DigitalGameStorage(Path(self.temp.name))
        self.runner = DigitalProcessRunner(self.storage)

    def tearDown(self):
        self.temp.cleanup()

    def make(self, name, files=("game.exe",)):
        folder = self.storage.root / name
        folder.mkdir(parents=True)
        for file in files:
            (folder / file).write_bytes(b"fixture")
        return folder

    def test_ready_with_content_is_installed_without_scanning_for_payload(self):
        self.make("5-My Game-ready", files=("anything.dat",))
        status = self.storage.status(5, "Other title")
        self.assertTrue(status["installed"])
        self.assertEqual(status["state"], "ready")

    def test_ready_but_empty_is_not_installed(self):
        self.make("5-My Game-ready", files=())
        self.assertFalse(self.storage.status(5, "My Game")["installed"])

    def test_transient_states_are_never_installed_even_with_an_executable(self):
        for state in ("preparing", "downloading", "installing"):
            with self.subTest(state=state):
                folder = self.make(f"6-Game-{state}")
                status = self.storage.status(6, "Game")
                self.assertFalse(status["installed"])
                self.assertEqual(status["state"], state)
                for item in folder.iterdir():
                    item.unlink()
                folder.rmdir()

    def test_error_state_exposes_error_txt(self):
        folder = self.make("8-Broken-ERROR", files=("error.txt",))
        (folder / "error.txt").write_text("error intentando descomprimir a.rar", encoding="utf-8")
        status = self.storage.status(8, "Broken")
        self.assertFalse(status["installed"])
        self.assertIn("a.rar", status["error"])

    def test_folder_without_status_keeps_the_payload_check(self):
        self.make("9-Old Game", files=("game.exe",))
        self.make("10-Only Archive", files=("fixture.rar",))
        self.assertTrue(self.storage.status(9, "Old Game")["installed"])
        self.assertFalse(self.storage.status(10, "Only Archive")["installed"])

    def test_folder_is_found_by_app_id_prefix_whatever_the_title_or_status(self):
        folder = self.make("11-Renamed-installing")
        self.assertEqual(self.storage.folder(11, "Another title"), folder.resolve())

    def test_stale_registry_path_does_not_hide_the_renamed_folder(self):
        old = self.storage.register(12, "Game")
        old.rmdir()
        folder = self.make("12-Game-ready")
        self.assertEqual(self.storage.folder(12, "Game"), folder.resolve())

    def test_snapshot_and_local_games_ignore_the_catalog_name_and_strip_the_status(self):
        self.make("13-Some-Title-ready")
        self.make("14-Half-Life 2-downloading")
        result = self.runner.run("snapshot", 0, "", json.dumps([{"id": 13, "name": "Catalog name"}, {"id": 14, "name": "x"}]))
        self.assertTrue(result["statuses"]["13"]["installed"])
        self.assertFalse(result["statuses"]["14"]["installed"])
        names = {game["id"]: game["name"] for game in self.storage.local_games()}
        self.assertEqual(names[13], "Some-Title")
        self.assertEqual(names[14], "Half-Life 2")


if __name__ == "__main__":
    unittest.main()
