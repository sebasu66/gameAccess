from __future__ import annotations

import threading

import provider_download_manager
import provider_download_probe


def test_same_provider_parallel_workers_reserve_distinct_login_ids(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setattr(
        provider_download_probe,
        "LOGIN_ID_ROOT",
        tmp_path / "loginids",
    )
    # Two worker threads plus the test thread rendezvous only after both
    # reservations are live at the same time.
    barrier = threading.Barrier(3)
    release = threading.Event()
    allocated: list[int] = []
    errors: list[BaseException] = []

    def worker(app_id: int) -> None:
        try:
            with provider_download_probe.reserve_download_login_id(
                "provider-007",
                app_id,
            ) as login_id:
                allocated.append(login_id)
                barrier.wait(timeout=3)
                release.wait(timeout=3)
        except BaseException as exc:  # test thread must report failures to parent
            errors.append(exc)

    first = threading.Thread(target=worker, args=(111,))
    second = threading.Thread(target=worker, args=(222,))
    first.start()
    second.start()
    barrier.wait(timeout=3)
    try:
        assert not errors
        assert len(allocated) == 2
        assert allocated[0] != allocated[1]
        assert all(
            value > provider_download_probe.DOWNLOAD_LOGIN_ID_BASE
            for value in allocated
        )
    finally:
        release.set()
        first.join(timeout=3)
        second.join(timeout=3)

    assert not errors
    assert list((tmp_path / "loginids").glob("*.lock")) == []


def test_two_download_manager_jobs_transfer_in_parallel(monkeypatch, tmp_path):
    monkeypatch.setattr(
        provider_download_manager,
        "STATUS_ROOT",
        tmp_path / "status",
    )
    monkeypatch.setattr(
        provider_download_manager,
        "LOG_ROOT",
        tmp_path / "logs",
    )

    barrier = threading.Barrier(3)
    release = threading.Event()
    prepared: list[tuple[int, int]] = []
    results: dict[int, dict] = {}
    errors: list[BaseException] = []

    def fake_run_probe(
        provider_id,
        app_id,
        *,
        manifest_only,
        download,
        timeout_seconds,
        progress_callback=None,
    ):
        del provider_id, timeout_seconds
        if manifest_only:
            assert not download
            return {
                "ok": True,
                "total_bytes": 100,
                "depot_totals": {"1": 100},
            }
        assert download
        assert progress_callback is not None
        progress_callback("Downloading depot 1")
        progress_callback("50% active")
        barrier.wait(timeout=3)
        release.wait(timeout=3)
        return {"ok": True, "total_bytes": 100, "app_id": app_id}

    def fake_inspect(app_id, provider_id):
        del provider_id
        return {
            "source_bytes": 100,
            "libraries": [
                {
                    "index": 1,
                    "manifest_exists": False,
                    "free_bytes": 10_000,
                    "target": f"D:/Steam/{app_id}",
                },
                {
                    "index": 2,
                    "manifest_exists": False,
                    "free_bytes": 10_000,
                    "target": f"E:/Steam/{app_id}",
                },
            ],
        }

    def fake_prepare(app_id, provider_id, library_index):
        del provider_id
        prepared.append((app_id, library_index))
        return {
            "ok": True,
            "prepared": True,
            "target": f"library-{library_index}/app-{app_id}",
        }

    monkeypatch.setattr(provider_download_manager, "run_probe", fake_run_probe)
    monkeypatch.setattr(provider_download_manager, "inspect", fake_inspect)
    monkeypatch.setattr(provider_download_manager, "prepare", fake_prepare)

    manager = provider_download_manager.SteamDownloadManager()

    def worker(app_id: int, library_index: int) -> None:
        try:
            results[app_id] = manager.run(
                app_id,
                "provider-007",
                f"job-{app_id}",
                library_index,
            )
        except BaseException as exc:  # surface thread failures in parent
            errors.append(exc)

    first = threading.Thread(target=worker, args=(111, 1))
    second = threading.Thread(target=worker, args=(222, 2))
    first.start()
    second.start()
    barrier.wait(timeout=3)
    try:
        assert not errors
        first_status = provider_download_manager.read_status(111)
        second_status = provider_download_manager.read_status(222)
        assert first_status and first_status["state"] == "downloading"
        assert second_status and second_status["state"] == "downloading"
    finally:
        release.set()
        first.join(timeout=3)
        second.join(timeout=3)

    assert not errors
    assert results[111]["state"] == "prepared"
    assert results[222]["state"] == "prepared"
    assert results[111]["library_index"] == 1
    assert results[222]["library_index"] == 2
    assert sorted(prepared) == [(111, 1), (222, 2)]


def test_explicit_library_selection_wins_over_lower_index_default():
    state = {
        "source_bytes": 100,
        "libraries": [
            {"index": 0, "free_bytes": 1000, "manifest_exists": False},
            {"index": 3, "free_bytes": 1000, "manifest_exists": False},
        ],
    }

    selected = provider_download_manager._prepared_library(state, 3)
    assert selected is not None
    assert selected["index"] == 3


def test_explicit_library_selection_rejects_insufficient_space():
    state = {
        "source_bytes": 1000,
        "libraries": [
            {"index": 0, "free_bytes": 5000, "manifest_exists": False},
            {"index": 2, "free_bytes": 50, "manifest_exists": False},
        ],
    }

    try:
        provider_download_manager._prepared_library(state, 2)
    except RuntimeError as exc:
        assert "espacio" in str(exc).casefold()
    else:
        raise AssertionError("selected library without enough space must be rejected")


def test_download_manager_is_the_orchestration_boundary():
    manager = provider_download_manager.SteamDownloadManager()
    assert callable(manager.validate)
    assert callable(manager.estimate)
    assert callable(manager.run)


def test_cancelled_cli_run_preserves_exit_code_three(monkeypatch):
    monkeypatch.setattr(
        provider_download_manager,
        "run_download",
        lambda *args, **kwargs: {
            "app_id": 42,
            "state": "cancelled",
            "installed": False,
        },
    )
    monkeypatch.setattr(provider_download_manager, "_print", lambda payload: None)
    monkeypatch.setattr(
        "sys.argv",
        [
            "provider_download_manager.py",
            "--app-id",
            "42",
            "--run",
            "--job-id",
            "job-42",
        ],
    )
    assert provider_download_manager.main() == 3
