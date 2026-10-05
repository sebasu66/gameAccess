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
