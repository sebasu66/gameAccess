"""Run the real hygiene code only against disposable temporary fixtures."""
import os
import time
from pathlib import Path
import pytest
import download_reconciliation as cleanup

def test_digital_payload_and_metadata_survive_hygiene_even_with_overlapping_roots(monkeypatch, tmp_path):
    games = tmp_path / "games"
    registry = tmp_path / ".cache" / "digital_games"
    registry.mkdir(parents=True)
    game = games / "Digital Fixture"
    probe = game / "1-manifest-only"
    staged = game / "1-download"
    for path in [probe, staged]:
        path.mkdir(parents=True)
        (path / "payload.bin").write_bytes(b"keep")
    pending = game / "download.tmp"
    pending.write_bytes(b"partial")
    os.utime(pending, (time.time()-999999, time.time()-999999))
    metadata = registry / "1.json"
    metadata.write_text("{}")
    monkeypatch.setattr(cleanup, "DIGITAL_PROTECTED_ROOTS", (games, registry))
    for field in ["DOWNLOAD_ROOT", "STATUS_ROOT", "LOG_ROOT", "LOCK_ROOT", "MEDIA_CACHE_ROOT", "TOOLS_ROOT"]:
        monkeypatch.setattr(cleanup, field, games)
    cleanup._run_storage_hygiene()
    assert pending.read_bytes() == b"partial"
    assert probe.is_dir() and staged.is_dir()
    assert metadata.is_file()
    assert not cleanup._staging_candidates()
    with pytest.raises(RuntimeError, match="Digital"):
        cleanup.remove_staging(1, "Digital Fixture")
    assert staged.is_dir()

def test_file_cleanup_skips_digital_but_still_removes_unrelated_temp(monkeypatch, tmp_path):
    digital = tmp_path / "games"
    digital.mkdir()
    protected = digital / "partial.tmp"
    protected.write_bytes(b"keep")
    disposable = tmp_path / "cache.tmp"
    disposable.write_bytes(b"remove")
    monkeypatch.setattr(cleanup, "DIGITAL_PROTECTED_ROOTS", (digital,))
    assert not cleanup._remove_regular_file(protected)
    assert cleanup._remove_regular_file(disposable)
    assert protected.is_file()

def test_runtime_refresh_preserves_game_folders_and_digital_registry(tmp_path):
    import hashlib
    import json
    import shutil
    import subprocess
    shell = shutil.which("pwsh")
    if not shell:
        pytest.skip("PowerShell needed for runtime staging regression")
    repository = Path(__file__).resolve().parents[2]
    source_script = repository / "desktop" / "scripts" / "prepare-python-runtime.ps1"
    # parents[2] is apps; fixture mirrors the real app layout.
    fixture = tmp_path / "repo"
    scripts = fixture / "apps" / "desktop" / "scripts"
    scripts.mkdir(parents=True)
    script = scripts / source_script.name
    shutil.copyfile(source_script, script)
    launcher = fixture / "apps" / "launcher"
    launcher.mkdir(parents=True)
    requirements = launcher / "requirements.txt"
    requirements.write_bytes(b"fixture")
    (launcher / "fixture.py").write_text("# refreshed runtime source")
    runtime = fixture / "apps" / "desktop" / "src-tauri" / "runtime"
    python = runtime / "python"
    python.mkdir(parents=True)
    (python / "python.exe").write_bytes(b"fixture")
    (python / "gameaccess-runtime.json").write_text(json.dumps({
        "python_version": "3.12.9", "requirements_sha256": hashlib.sha256(b"fixture").hexdigest().upper()}))
    game = runtime / "launcher" / "games" / "Digital Fixture"
    game.mkdir(parents=True)
    payload = game / "game.exe"
    payload.write_bytes(b"preserve")
    game_cache = game / "__pycache__"
    game_cache.mkdir()
    (game_cache / "data").write_bytes(b"preserve game data")
    registry = runtime / "launcher" / ".cache" / "digital_games"
    registry.mkdir(parents=True)
    (registry / "1.json").write_text("{}")
    result = subprocess.run([shell, "-NoProfile", "-File", str(script)], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    assert payload.read_bytes() == b"preserve"
    assert (game_cache / "data").read_bytes() == b"preserve game data"
    assert (registry / "1.json").is_file()
    assert (runtime / "launcher" / "fixture.py").is_file()
