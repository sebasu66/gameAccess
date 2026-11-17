import tempfile
import unittest
from pathlib import Path

from game_execution_manager.runtimes import classify, find_installers, missing_runtimes


class RuntimeTests(unittest.TestCase):
    def test_finds_only_installers_inside_redist_folders(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp)
            (game / "_CommonRedist" / "vcredist" / "2015").mkdir(parents=True)
            (game / "_CommonRedist" / "vcredist" / "2015" / "vc_redist.x64.exe").write_bytes(b"x")
            (game / "vc_redist.x64.exe").write_bytes(b"x")  # next to the game, not in a redist folder
            names = [p.name for p in find_installers(game)]
            self.assertEqual(names, ["vc_redist.x64.exe"])

    def test_classify_by_name(self):
        self.assertEqual(classify(Path("vcredist_x86_2010.exe"))[:2], ("vc2010", "x86"))
        self.assertEqual(classify(Path("vc_redist.x64.exe"))[:2], ("vc2015", "x64"))
        self.assertEqual(classify(Path("DXSETUP.exe"))[0], "directx")

    def test_missing_only_what_windows_lacks(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp)
            (game / "redist").mkdir()
            (game / "redist" / "vc_redist.x64.exe").write_bytes(b"x")
            (game / "redist" / "DXSETUP.exe").write_bytes(b"x")
            lacking = missing_runtimes(game, exists=lambda path: path.name == "vcruntime140.dll")
            self.assertEqual([item["id"] for item in lacking], ["directx"])
            self.assertEqual(missing_runtimes(game, exists=lambda path: True), [])


if __name__ == "__main__":
    unittest.main()
