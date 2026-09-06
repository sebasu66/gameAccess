import unittest

from transfer_core import FileQHost, TransferError, human_bytes, is_magnet, select_file_ids


class CoreTests(unittest.TestCase):
    def test_magnet_detection(self):
        self.assertTrue(is_magnet("magnet:?xt=urn:btih:abc"))
        self.assertFalse(is_magnet("C:/downloads/test.torrent"))

    def test_largest_file_selection(self):
        files = [
            {"id": 1, "path": "/readme.txt", "bytes": 100},
            {"id": 2, "path": "/game.iso", "bytes": 5000},
            {"id": 3, "path": "/art.jpg", "bytes": 200},
        ]
        self.assertEqual(select_file_ids(files, "largest"), [2])
        self.assertEqual(select_file_ids(files, "all"), [1, 2, 3])

    def test_selection_rejects_empty_metadata(self):
        with self.assertRaises(TransferError):
            select_file_ids([], "largest")

    def test_fileq_code_variants(self):
        self.assertEqual(FileQHost._extract_file_code({"file_code": "abc"}), "abc")
        self.assertEqual(FileQHost._extract_file_code({"result": {"filecode": "def"}}), "def")
        self.assertEqual(FileQHost._extract_file_code({"status": 200, "msg": "WORKING"}), "")

    def test_human_bytes(self):
        self.assertEqual(human_bytes(1024), "1.0 KB")
        self.assertEqual(human_bytes(None), "unknown")


if __name__ == "__main__":
    unittest.main()
