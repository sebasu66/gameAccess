from __future__ import annotations

import pool_sync


def test_ownership_state_uses_durable_verified_provider_inventory(monkeypatch):
    class FakeStore:
        def states(self):
            return {
                "provider-004": {
                    "ownership_source": "steamkit-license-list-pics",
                    "ownership_verified_at": "2026-09-04T20:06:15+00:00",
                    "inventory_complete": True,
                    "owned_app_ids": {730},
                    "scan_status": "ok",
                    "scan_error": None,
                }
            }

    monkeypatch.setattr(pool_sync, "ProviderOwnershipStore", FakeStore)

    state, metadata = pool_sync._ownership_state_by_provider()

    assert state["provider-004"]["scan_status"] == "ok"
    assert state["provider-004"]["owned_app_ids"] == {730}
    assert metadata["verified_at"] == "2026-09-04T20:06:15+00:00"
    assert metadata["verification_errors"] == []
    assert metadata["latest_inventory_complete"] is True


def test_latest_scan_error_does_not_erase_known_owned_apps(monkeypatch):
    class FakeStore:
        def states(self):
            return {
                "provider-001": {
                    "ownership_source": "steamkit-license-list-pics",
                    "ownership_verified_at": "2026-09-04T18:00:00+00:00",
                    "inventory_complete": True,
                    "owned_app_ids": {10, 20},
                    "scan_status": "temporarily_unavailable",
                    "scan_error": "AlreadyLoggedInElsewhere",
                }
            }

    monkeypatch.setattr(pool_sync, "ProviderOwnershipStore", FakeStore)

    state, metadata = pool_sync._ownership_state_by_provider()

    assert state["provider-001"]["owned_app_ids"] == {10, 20}
    assert metadata["verified_at"] == "2026-09-04T18:00:00+00:00"
    assert metadata["verification_errors"] == [{
        "provider_id": "provider-001",
        "status": "temporarily_unavailable",
        "error": "AlreadyLoggedInElsewhere",
    }]
