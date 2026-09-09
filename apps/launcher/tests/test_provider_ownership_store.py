from __future__ import annotations

from provider_ownership_store import ProviderOwnershipStore


def snapshot(provider_id: str, app_ids: list[int], *, verified_at: str, status: str = "ok", complete: bool = True):
    return {
        "source": "steamkit-license-list-pics",
        "verified_at": verified_at,
        "accounts": [{"provider_id": provider_id, "owned_app_ids": app_ids, "scan_status": status}],
        "scans": [{"provider_id": provider_id, "status": status, "complete": complete}],
        "errors": [] if status == "ok" else [{"provider_id": provider_id, "error": status}],
    }


def test_success_replaces_only_that_provider_ownership(tmp_path) -> None:
    store = ProviderOwnershipStore(tmp_path / "ownership.db")
    store.record_scan(snapshot("provider-001", [10, 20], verified_at="2026-09-08T10:00:00+00:00"))
    store.record_scan(snapshot("provider-001", [20, 30], verified_at="2026-09-08T11:00:00+00:00"))
    state = store.states()["provider-001"]
    assert state["owned_app_ids"] == {20, 30}
    assert state["inventory_complete"] is True
    assert state["scan_status"] == "ok"


def test_failed_scan_preserves_last_verified_ownership(tmp_path) -> None:
    store = ProviderOwnershipStore(tmp_path / "ownership.db")
    store.record_scan(snapshot("provider-001", [10, 20], verified_at="2026-09-08T10:00:00+00:00"))
    store.record_scan(snapshot("provider-001", [], verified_at="2026-09-08T11:00:00+00:00", status="timeout", complete=False))
    state = store.states()["provider-001"]
    assert state["owned_app_ids"] == {10, 20}
    assert state["inventory_complete"] is True
    assert state["scan_status"] == "timeout"
    assert state["scan_error"] == "timeout"


def test_partial_batch_updates_success_without_erasing_other_provider(tmp_path) -> None:
    store = ProviderOwnershipStore(tmp_path / "ownership.db")
    store.record_scan(snapshot("provider-001", [10], verified_at="2026-09-08T10:00:00+00:00"))
    store.record_scan(snapshot("provider-002", [20, 30], verified_at="2026-09-08T11:00:00+00:00"))
    states = store.states()
    assert states["provider-001"]["owned_app_ids"] == {10}
    assert states["provider-002"]["owned_app_ids"] == {20, 30}
