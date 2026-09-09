import csv
from pathlib import Path

import provider_account_onboard as onboard
import pytest


@pytest.fixture(autouse=True)
def isolate_family_evidence(tmp_path, monkeypatch):
    monkeypatch.setattr(onboard, "DEFAULT_OUTPUT", tmp_path / "provider_licenses.json")


def test_upsert_provider_credentials_appends_then_updates_without_duplicate(
    tmp_path: Path,
) -> None:
    path = tmp_path / "accFull.csv"
    path.write_text("username,password\nexisting,old-pass\n", encoding="utf-8")

    credential, created = onboard.upsert_provider_credentials(
        path, "new-user", "first-pass"
    )
    assert created is True
    assert credential.provider_id == "provider-002"
    assert credential.label == "new-user"

    credential, created = onboard.upsert_provider_credentials(
        path, "new-user", "changed-pass"
    )
    assert created is False
    assert credential.provider_id == "provider-002"

    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    matching = [row for row in rows if row and row[0] == "new-user"]
    assert matching == [["new-user", "changed-pass"]]


def test_onboard_scans_and_syncs_only_the_selected_provider(
    tmp_path: Path, monkeypatch
) -> None:
    path = tmp_path / "accFull.csv"
    path.write_text("existing,old-pass\n", encoding="utf-8")
    calls: list[tuple[str, str, dict | None]] = []
    persisted: list[dict] = []
    family_inputs: list[dict] = []

    def fake_scan(*, provider_ids, timeout_seconds):
        assert provider_ids == {"provider-002"}
        assert timeout_seconds == 42
        return {
            "source": "steamkit-license-list-pics",
            "verified_at": "2026-09-07T20:00:00+00:00",
            "accounts": [
                {
                    "provider_id": "provider-001",
                    "owned_app_ids": [],
                    "scan_status": "not_scanned",
                },
                {
                    "provider_id": "provider-002",
                    "owned_app_ids": [10, 20, 30],
                    "accessible_app_ids": [10, 20, 30, 40],
                    "scan_status": "ok",
                    "family_key": "standalone:provider-002",
                    "family_member_provider_ids": ["provider-002"],
                },
            ],
            "scans": [
                {"provider_id": "provider-002", "status": "ok", "complete": True},
            ],
            "errors": [],
        }

    def fake_api(method: str, url: str, *, payload=None, timeout=30.0):
        calls.append((method, url, payload))
        if url.endswith("/admin/pool/roster-status"):
            return {"ok": True}
        if url.endswith("/steam/apps/10"):
            return {
                "app_id": 10,
                "name": "Windows Game",
                "type": "game",
                "windows": True,
            }
        if url.endswith("/steam/apps/20"):
            return {"app_id": 20, "name": "DLC", "type": "dlc", "windows": True}
        if url.endswith("/steam/apps/30"):
            return {
                "app_id": 30,
                "name": "Linux Game",
                "type": "game",
                "windows": False,
            }
        if url.endswith("/admin/games/import-steam/10"):
            return {"game": {"id": 501, "app_id": 10}}
        if url.endswith("/admin/accounts/sync"):
            assert payload is not None
            assert payload["label"] == "new-user"
            assert payload["game_ids"] == [501]
            assert '"accessible_app_ids":[10,20,30,40]' in payload["notes"]
            return {
                "ok": True,
                "account": {"id": 9, "label": "new-user", "game_ids": [501]},
            }
        if url.endswith("/admin/pool/families/sync"):
            assert payload == {"families": [{"family_key": "standalone:provider-002"}]}
            return {"ok": True, "families": 1, "license_copies": 1}
        raise AssertionError(f"unexpected API call: {method} {url}")

    monkeypatch.setattr(onboard, "scan_provider_licenses", fake_scan)
    monkeypatch.setattr(
        onboard, "persist_scan_result", lambda value: persisted.append(value)
    )
    monkeypatch.setattr(
        onboard, "load_provider_license_inventory", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        onboard,
        "build_family_graph",
        lambda value: (
            family_inputs.append(value) or [{"family_key": "standalone:provider-002"}]
        ),
    )
    monkeypatch.setattr(onboard, "_api_json", fake_api)

    result = onboard.onboard_provider_account(
        api="http://127.0.0.1:38147",
        login="new-user",
        password="secret-value",
        accounts_path=path,
        timeout_seconds=42,
    )

    assert result["ok"] is True
    assert result["provider_id"] == "provider-002"
    assert result["owned_app_count"] == 3
    assert result["accessible_app_count"] == 4
    assert result["catalog_game_count"] == 1
    assert result["unresolved_app_count"] == 0
    assert len(persisted) == 1
    assert len(family_inputs) == 1
    assert not any(url.endswith("/admin/pool/sync") for _, url, _ in calls)
    assert sum(url.endswith("/admin/accounts/sync") for _, url, _ in calls) == 1


def test_family_merge_overlays_only_fresh_provider(monkeypatch) -> None:
    authoritative = {
        "complete": True,
        "verified_at": "2026-09-04T00:00:00+00:00",
        "accounts": [
            {"provider_id": "provider-001", "owned_app_ids": [1], "scan_status": "ok"},
            {"provider_id": "provider-002", "owned_app_ids": [2], "scan_status": "ok"},
        ],
    }
    partial = {
        "verified_at": "2026-09-08T00:00:00+00:00",
        "scans": [{"provider_id": "provider-002", "status": "ok", "complete": True}],
        "accounts": [
            {
                "provider_id": "provider-001",
                "owned_app_ids": [],
                "scan_status": "not_scanned",
            },
            {
                "provider_id": "provider-002",
                "owned_app_ids": [2, 3],
                "scan_status": "ok",
            },
        ],
    }
    monkeypatch.setattr(
        onboard,
        "load_provider_license_inventory",
        lambda *args, **kwargs: authoritative,
    )

    merged = onboard._merge_family_inventory(partial, "provider-002")
    by_provider = {row["provider_id"]: row for row in merged["accounts"]}

    assert by_provider["provider-001"]["owned_app_ids"] == [1]
    assert by_provider["provider-001"]["scan_status"] == "ok"
    assert by_provider["provider-002"]["owned_app_ids"] == [2, 3]


def test_batch_scan_runs_only_explicit_provider_ids(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "accFull.csv"
    path.write_text(
        "first,pass-1\nsecond,pass-2\nthird,pass-3\n",
        encoding="utf-8",
    )
    scan_calls: list[set[str]] = []
    synced: list[str] = []
    family_selected: list[set[str]] = []

    def fake_scan(*, provider_ids, timeout_seconds):
        scan_calls.append(set(provider_ids))
        assert timeout_seconds == 55
        return {
            "source": "steamkit-license-list-pics",
            "verified_at": "2026-09-09T10:00:00+00:00",
            "accounts": [
                {
                    "provider_id": "provider-001",
                    "owned_app_ids": [],
                    "scan_status": "not_scanned",
                },
                {
                    "provider_id": "provider-002",
                    "owned_app_ids": [10],
                    "accessible_app_ids": [10],
                    "scan_status": "ok",
                },
                {
                    "provider_id": "provider-003",
                    "owned_app_ids": [20],
                    "accessible_app_ids": [20],
                    "scan_status": "ok",
                },
            ],
            "scans": [
                {"provider_id": "provider-002", "status": "ok", "complete": True},
                {"provider_id": "provider-003", "status": "ok", "complete": True},
            ],
            "errors": [],
        }

    def fake_api(method: str, url: str, *, payload=None, timeout=30.0):
        if url.endswith("/admin/pool/roster-status"):
            return {"ok": True}
        if url.endswith("/admin/pool/families/sync"):
            return {"ok": True}
        raise AssertionError(f"unexpected API call: {method} {url}")

    def fake_sync_verified_provider(*, credential, **kwargs):
        synced.append(credential.provider_id)
        return {
            "provider_id": credential.provider_id,
            "label": credential.label,
            "owned_app_count": 1,
            "accessible_app_count": 1,
            "catalog_game_count": 1,
            "unresolved_app_count": 0,
            "unresolved_app_ids": [],
            "account": None,
        }

    def fake_merge(inventory, provider_ids):
        family_selected.append(set(provider_ids))
        return {"accounts": []}

    monkeypatch.setattr(onboard, "scan_provider_licenses", fake_scan)
    monkeypatch.setattr(
        onboard,
        "persist_scan_result",
        lambda value: {"saved": True, "authoritative_updated": False},
    )
    monkeypatch.setattr(onboard, "_api_json", fake_api)
    monkeypatch.setattr(onboard, "_sync_verified_provider", fake_sync_verified_provider)
    monkeypatch.setattr(onboard, "_merge_family_inventory", fake_merge)
    monkeypatch.setattr(
        onboard,
        "build_family_graph",
        lambda value: [{"family_key": "batch-family"}],
    )

    result = onboard.scan_provider_accounts(
        api="http://127.0.0.1:38147",
        provider_ids=["provider-002", "provider-003", "provider-002"],
        accounts_path=path,
        timeout_seconds=55,
    )

    assert result["ok"] is True
    assert result["requested_provider_count"] == 2
    assert result["successful_provider_count"] == 2
    assert result["failed_provider_count"] == 0
    assert scan_calls == [{"provider-002", "provider-003"}]
    assert synced == ["provider-002", "provider-003"]
    assert family_selected == [{"provider-002", "provider-003"}]
    assert "provider-001" not in synced
