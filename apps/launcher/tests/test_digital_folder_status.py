import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_library_manager.storage import DigitalGameStorage, split_folder_name
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


class StorageCase(unittest.TestCase):
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


class FolderStatusTests(StorageCase):
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

    def test_error_state_still_reads_a_legacy_error_txt(self):
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


class PruneAndAbortTests(StorageCase):
    def old(self, folder, seconds=3600):
        import os, time
        stamp = time.time() - seconds
        os.utime(folder, (stamp, stamp))

    def test_prune_removes_only_old_empty_folders_without_status(self):
        stale = self.make("20-Stale", files=())
        self.old(stale)
        keep = {
            "full": self.make("21-Full", files=("game.exe",)),
            "young": self.make("22-Young", files=()),
            "downloading": self.make("23-Waiting-downloading", files=()),
            "error": self.make("24-Failed-ERROR", files=()),
            "not-a-game": self.make("Documents", files=()),
        }
        for folder in keep.values():
            self.old(folder)
        self.old(keep["young"], seconds=5)
        removed = self.storage.prune_empty()
        self.assertEqual([path.name for path in removed], ["20-Stale"])
        self.assertFalse(stale.exists())
        self.assertTrue(all(folder.exists() for folder in keep.values()))

    def test_prune_keeps_a_folder_whose_worker_is_still_alive(self):
        folder = self.make("25-Busy", files=())
        self.old(folder)
        status = self.storage.launcher / ".cache" / "digital_downloads"
        status.mkdir(parents=True)
        (status / "25.json").write_text("{}")
        self.assertEqual(self.storage.prune_empty(), [])
        self.assertTrue(folder.exists())
        self.old(status / "25.json", seconds=3600)
        self.assertEqual(len(self.storage.prune_empty()), 1)

    def test_snapshot_cleans_leftovers_on_the_way(self):
        stale = self.make("26-Stale", files=())
        self.old(stale)
        self.runner.run("snapshot", 0, "", json.dumps([{"id": 26, "name": "Stale"}]))
        self.assertFalse(stale.exists())

    def test_cancel_runs_hooks_but_an_error_keeps_the_folder(self):
        from game_download_manager import worker as digital_downloader
        from unittest.mock import patch
        calls = []
        try:
            for message in (None, "boom"):
                digital_downloader.g_cancel_hooks[:] = [lambda: calls.append(message)]
                with patch.object(digital_downloader, "emit_progress"), patch.object(digital_downloader, "emit_error"), self.assertRaises(SystemExit):
                    digital_downloader.cleanup_on_cancel(error_message=message)
        finally:
            digital_downloader.g_cancel_hooks[:] = []
            digital_downloader.g_cancelled.clear()
        self.assertEqual(calls, [None])


class SetStatusTests(StorageCase):
    def test_set_status_renames_in_place_and_keeps_the_registry_pointing_at_it(self):
        self.storage.register(9, "Half-Life 2")
        first = self.storage.set_status(9, "Half-Life 2", "preparing")
        self.assertEqual(first.name, "9-Half-Life 2-preparing")
        second = self.storage.set_status(9, "Half-Life 2", "downloading")
        self.assertEqual(second.name, "9-Half-Life 2-downloading")
        self.assertEqual(self.storage.folder(9, "other title"), second)
        record = json.loads((self.storage.registry / "9.json").read_text(encoding="utf-8"))
        self.assertEqual(Path(record["folder"]), second)
        self.assertEqual(len([p for p in self.storage.root.iterdir()]), 1)

    def test_set_status_rejects_unknown_states(self):
        self.storage.register(9, "Game")
        with self.assertRaises(ValueError):
            self.storage.set_status(9, "Game", "done")

    def test_write_error_marks_the_folder_and_status_reports_the_message(self):
        self.storage.register(5, "Broken")
        folder = self.storage.write_error(5, "Broken", "error intentando descomprimir a.rar: CRC")
        self.assertTrue(folder.name.endswith("-ERROR"))
        result = self.storage.status(5, "Broken")
        self.assertEqual(result["state"], "ERROR")
        self.assertFalse(result["installed"])
        self.assertIn("descomprimir a.rar", result["error"])
        self.assertTrue(result["needs_repair"])
        self.assertFalse((folder / "error.txt").exists())
        self.assertIn("| ERROR | error intentando descomprimir a.rar: CRC", (folder / "gameaccess-log.txt").read_text(encoding="utf-8"))

    def test_empty_preparing_leftovers_are_pruned_but_downloading_ones_are_kept(self):
        import os
        for status in ("preparing", "downloading"):
            folder = self.storage.root / f"{3 if status == 'preparing' else 4}-G-{status}"
            folder.mkdir(parents=True)
            os.utime(folder, (1, 1))
        self.storage.prune_empty()
        names = sorted(p.name for p in self.storage.root.iterdir())
        self.assertEqual(names, ["4-G-downloading"])


if __name__ == "__main__":
    unittest.main()
