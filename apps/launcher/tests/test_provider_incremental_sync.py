from __future__ import annotations

from provider_incremental_sync import successful_provider_ids


def test_successful_provider_ids_keeps_only_complete_successes() -> None:
    inventory = {
        "scans": [
            {"provider_id": "provider-094", "status": "ok", "complete": True},
            {"provider_id": "provider-095", "status": "ok", "complete": False},
            {"provider_id": "provider-096", "status": "timeout", "complete": False},
            {"provider_id": "provider-097", "status": "ok", "complete": True},
        ]
    }

    assert successful_provider_ids(inventory) == ["provider-094", "provider-097"]


def test_successful_provider_ids_is_stable_for_empty_or_invalid_rows() -> None:
    assert successful_provider_ids({}) == []
    assert successful_provider_ids({"scans": [None, {}, {"provider_id": "provider-001"}]}) == []
