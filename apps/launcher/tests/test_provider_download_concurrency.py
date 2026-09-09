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
