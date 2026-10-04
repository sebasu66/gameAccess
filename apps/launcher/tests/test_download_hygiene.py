from __future__ import annotations

import json
import os
import time
from pathlib import Path

import download_log
import download_reconciliation as reconciliation
import provider_download_manager as manager


def _configure_roots(monkeypatch, tmp_path: Path) -> Path:
    root = tmp_path / "GameAccess"
    downloads = root / "downloads"
    monkeypatch.setattr(reconciliation, "RUNTIME_ROOT", root)
    monkeypatch.setattr(reconciliation, "DOWNLOAD_ROOT", downloads)
    monkeypatch.setattr(reconciliation, "STATUS_ROOT", downloads / "status")
    monkeypatch.setattr(reconciliation, "LOG_ROOT", downloads / "logs")
    monkeypatch.setattr(reconciliation, "LOCK_ROOT", root / "locks")
    monkeypatch.setattr(reconciliation, "MEDIA_CACHE_ROOT", root / "media-cache")
    return root


def _status(root: Path, app_id: int, state: str, provider_id: str = "provider-a") -> Path:
    path = root / "downloads" / "status" / f"app-{app_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "app_id": app_id,
                "state": state,
                "provider_id": provider_id,
                "job_id": f"job-{app_id}",
                "installed": False,
            }
        ),
        encoding="utf-8",
    )
    return path


def test_hygiene_preserves_active_and_recoverable_downloads(monkeypatch, tmp_path) -> None:
    root = _configure_roots(monkeypatch, tmp_path)
    provider = root / "downloads" / "provider-a"
    staging = provider / "400-download"
    probe = provider / "400-manifest-only"
    staging.mkdir(parents=True)
    probe.mkdir(parents=True)
    (staging / "payload.bin").write_bytes(b"x" * 1024)
    (probe / "manifest.txt").write_text("probe", encoding="utf-8")
    status = _status(root, 400, "downloading")

    reconciliation._run_storage_hygiene()
    assert staging.is_dir()
    assert probe.is_dir()

    status.write_text(
        json.dumps(
            {
                "app_id": 400,
                "state": "interrupted",
                "provider_id": "provider-a",
                "job_id": "job-400",
                "installed": False,
            }
        ),
        encoding="utf-8",
    )
    reconciliation._run_storage_hygiene()
    assert staging.is_dir()
    assert not probe.exists()

    interrupted = reconciliation.reconcile()
    assert [item["app_id"] for item in interrupted] == [400]
    assert staging.is_dir()


def test_cancelled_download_staging_is_pruned(monkeypatch, tmp_path) -> None:
    root = _configure_roots(monkeypatch, tmp_path)
    provider = root / "downloads" / "provider-a"
    staging = provider / "400-download"
    probe = provider / "400-manifest-only"
    staging.mkdir(parents=True)
    probe.mkdir(parents=True)
    (staging / "payload.bin").write_bytes(b"x" * 512)
    (probe / "manifest.txt").write_text("probe", encoding="utf-8")
    status = _status(root, 400, "cancelled")

    assert reconciliation.reconcile() == []
    assert not staging.exists()
    assert not probe.exists()
    assert not status.exists()


def test_storage_hygiene_prunes_stale_misc_files_and_bounds_logs(monkeypatch, tmp_path) -> None:
    root = _configure_roots(monkeypatch, tmp_path)
    monkeypatch.setattr(reconciliation, "STALE_TEMP_SECONDS", 1)
    monkeypatch.setattr(reconciliation, "STALE_LOCK_SECONDS", 1)
    monkeypatch.setattr(reconciliation, "DOWNLOAD_LOG_MAX_AGE_SECONDS", 60 * 60)
    monkeypatch.setattr(reconciliation, "DOWNLOAD_LOG_MAX_BYTES", 100)
    monkeypatch.setattr(reconciliation, "MEDIA_CACHE_MAX_AGE_SECONDS", 60 * 60)
    monkeypatch.setattr(reconciliation, "MEDIA_CACHE_MAX_BYTES", 100)

    temp = root / "downloads" / "status" / "stale.tmp"
    temp.parent.mkdir(parents=True, exist_ok=True)
    temp.write_bytes(b"x")
    lock = root / "locks" / "stale.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    lock.write_bytes(b"x")
    old = time.time() - 7200
    os.utime(temp, (old, old))
    os.utime(lock, (old, old))

    logs = root / "downloads" / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    (logs / "app-1.jsonl").write_bytes(b"a" * 80)
    (logs / "app-2.jsonl").write_bytes(b"b" * 80)

    media = root / "media-cache"
    media.mkdir(parents=True, exist_ok=True)
    (media / "steam-1.json").write_bytes(b"a" * 80)
    (media / "steam-2.json").write_bytes(b"b" * 80)

    report = reconciliation._run_storage_hygiene()
    assert not temp.exists()
    assert not lock.exists()
    assert report["stale_temp_files_removed"] == 1
    assert report["stale_locks_removed"] == 1
    assert sum(path.stat().st_size for path in logs.iterdir()) <= 100
    assert sum(path.stat().st_size for path in media.iterdir()) <= 100


def test_manifest_probe_is_deleted_immediately_after_estimate(monkeypatch, tmp_path) -> None:
    root = tmp_path / "GameAccess"
    monkeypatch.setattr(manager, "RUNTIME_ROOT", root)

    def fake_probe(provider_id, app_id, **_kwargs):
        probe = root / "downloads" / provider_id / f"{app_id}-manifest-only"
        probe.mkdir(parents=True, exist_ok=True)
        (probe / "manifest.txt").write_text("temporary", encoding="utf-8")
        return {"ok": True, "total_bytes": 1234, "depot_totals": {"1": 1234}}

    monkeypatch.setattr(manager, "run_probe", fake_probe)
    result = manager.estimate_download(400, "provider-a")
    assert result["bytes_total"] == 1234
    assert not (root / "downloads" / "provider-a" / "400-manifest-only").exists()


def test_old_download_tool_versions_are_pruned_only_when_idle(monkeypatch, tmp_path) -> None:
    root = _configure_roots(monkeypatch, tmp_path)
    tools = root / "tools"
    current = tools / "depotdownloader-3.4.0"
    old = tools / "depotdownloader-3.3.0"
    current.mkdir(parents=True)
    old.mkdir(parents=True)
    (current / "DepotDownloader.exe").write_bytes(b"current")
    (old / "DepotDownloader.exe").write_bytes(b"old")
    monkeypatch.setattr(reconciliation, "TOOLS_ROOT", tools)
    monkeypatch.setattr(reconciliation, "CURRENT_DEPOTDOWNLOADER_ROOT", current)

    removed, _bytes = reconciliation._prune_old_download_tools(set())
    assert removed == 1
    assert current.is_dir()
    assert not old.exists()

    old.mkdir(parents=True)
    (old / "DepotDownloader.exe").write_bytes(b"old")
    removed, _bytes = reconciliation._prune_old_download_tools({400})
    assert removed == 0
    assert old.is_dir()


def test_download_logs_rotate_and_stay_bounded(monkeypatch, tmp_path) -> None:
    log_root = tmp_path / "downloads" / "logs"
    monkeypatch.setattr(download_log, "MAX_LOG_BYTES", 160)
    monkeypatch.setattr(download_log, "MAX_LOG_LINE_CHARS", 80)

    for index in range(20):
        download_log.append_download_log(
            log_root,
            400,
            {"app_id": 400, "event": "progress", "index": index, "detail": "x" * 40},
        )

    current = log_root / "app-400.jsonl"
    archive = log_root / "app-400.jsonl.1"
    assert current.is_file()
    assert current.stat().st_size <= 160
    assert archive.is_file()
    assert archive.stat().st_size <= 160
