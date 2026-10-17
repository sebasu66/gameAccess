"""Status updates survive a temporary Windows file-sharing conflict."""
import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

LAUNCHER = Path(__file__).resolve().parents[1]

def test_terminal_status_retries_temporary_sharing_conflict(tmp_path):
    spec = importlib.util.spec_from_file_location("downloader_status_fixture", LAUNCHER / "game_download_manager" / "worker.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.LAUNCHER_DIR = tmp_path
    real_replace = module.os.replace
    attempts = []
    def replace(source, target):
        attempts.append(target)
        if len(attempts) == 1:
            raise PermissionError("Temporary reader sharing conflict")
        return real_replace(source, target)
    with patch.object(module.os, "replace", side_effect=replace), patch.object(module.time, "sleep"):
        module.emit_json({"appId": "123", "phase": "completed", "bytesDownloaded": 2048})
    assert len(attempts) == 2
    saved = json.loads((tmp_path / ".cache/digital_downloads/123.json").read_text(encoding="utf-8"))
    assert saved["phase"] == "completed"
    assert saved["bytesDownloaded"] == 2048
