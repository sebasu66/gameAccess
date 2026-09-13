import csv
from pathlib import Path

import provider_account_onboard as onboard
import pytest


@pytest.fixture(autouse=True)
def isolate_family_evidence(tmp_path, monkeypatch):
    monkeypatch.setattr(onboard, "DEFAULT_STORE", tmp_path / "provider_ownership.db")


def test_upsert_provider_credentials_appends_then_updates_without_duplicate(tmp_path: Path) -> None:
    path = tmp_path / "accFull.csv"
    path.write_text("username,password\nexisting,old-pass\n", encoding="utf-8")
    credential, created = onboard.upsert_provider_credentials(path, "new-user", "first-pass")
    assert created is True
    assert credential.provider_id == "new-user"
    assert credential.label == "new-user"
    credential, created = onboard.upsert_provider_credentials(path, "new-user", "changed-pass")
    assert created is False
    assert credential.provider_id == "new-user"
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    assert [row for row in rows if row and row[0] == "new-user"] == [["new-user", "changed-pass"]]


def test_onboard_registers_every_verified_app_before_metadata(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "accFull.csv"
    path.write_text("existing,old-pass\n", encoding="utf-8")
    calls = []
    persisted = []
    family_inputs = []
    ownership_inputs = []

    def fake_scan(*, provider_ids, timeout_seconds):
        assert provider_ids == {"new-user"}
        assert timeout_seconds == 42
        return {
            "source": "steamkit-license-list-pics",
            "verified_at": "2026-09-07T20:00:00+00:00",
            "accounts": [
                {"provider_id": "existing", "owned_app_ids": [], "scan_status": "not_scanned"},
                {
                    "provider_id": "new-user",
                    "owned_app_ids": [10, 20, 30],
                    "accessible_app_ids": [10, 20, 30, 40],
                    "scan_status": "ok",
                    "family_key": "standalone:new-user",
                    "family_member_provider_ids": ["new-user"],
                },
            ],
            "scans": [{"provider_id": "new-user", "status": "ok", "complete": True}],
            "errors": [],
        }

    class FakeOwnershipStore:
        def record_scan(self, inventory):
            ownership_inputs.append(inventory)
            return {"attempted": 1, "promoted": 1}

    app_to_game = {10: 501, 20: 502, 30: 503, 40: 504}

    def fake_api(method, url, *, payload=None, timeout=30.0):
        calls.append((method, url, payload))
        if url.endswith("/admin/pool/roster-status"):
            return {"ok": True}
        for app_id, game_id in app_to_game.items():
            if url.endswith(f"/admin/pool/games/register-steam/{app_id}"):
                return {
                    "ok": True,
                    "metadata_state": "pending",
                    "game": {"id": game_id, "app_id": app_id, "active": False},
                }
        if url.endswith("/admin/accounts/sync"):
            assert payload["label"] == "new-user"
            assert payload["game_ids"] == [501, 502, 503, 504]
            assert '"accessible_app_ids":[10,20,30,40]' in payload["notes"]
            assert '"metadata_enrichment":"server-background"' in payload["notes"]
            return {
                "ok": True,
                "account": {"id": 9, "label": "new-user", "game_ids": payload["game_ids"]},
            }
        if url.endswith("/admin/pool/families/sync"):
            assert payload == {"families": [{"family_key": "standalone:new-user"}]}
            return {"ok": True, "families": 1, "license_copies": 1}
        raise AssertionError(f"unexpected API call: {method} {url}")

    monkeypatch.setattr(onboard, "scan_provider_licenses", fake_scan)
    monkeypatch.setattr(onboard, "ProviderOwnershipStore", FakeOwnershipStore)
    monkeypatch.setattr(onboard, "persist_scan_result", lambda value: persisted.append(value))
    monkeypatch.setattr(
        onboard,
        "build_family_graph",
        lambda value: family_inputs.append(value)
        or [{"family_key": "standalone:new-user"}],
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
    assert result["provider_id"] == "new-user"
    assert result["owned_app_count"] == 3
    assert result["accessible_app_count"] == 4
    assert result["registered_app_count"] == 4
    assert result["catalog_game_count"] == 4
    assert result["metadata_pending_count"] == 4
    assert result["ownership_promoted"] == 1
    assert result["unresolved_app_count"] == 0
    assert len(ownership_inputs) == 1
    assert len(persisted) == 1
    assert len(family_inputs) == 1
    assert not any("/steam/apps/" in url for _, url, _ in calls)
    assert not any("/admin/games/import-steam/" in url for _, url, _ in calls)
    assert sum("/admin/pool/games/register-steam/" in url for _, url, _ in calls) == 4
    assert sum(url.endswith("/admin/accounts/sync") for _, url, _ in calls) == 1


def test_metadata_registration_failure_does_not_hide_other_owned_apps(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "accFull.csv"
    path.write_text("existing,old-pass\n", encoding="utf-8")

    def fake_scan(*, provider_ids, timeout_seconds):
        return {
            "source": "steamkit-license-list-pics",
            "verified_at": "2026-09-07T20:00:00+00:00",
            "accounts": [
                {
                    "provider_id": "new-user",
                    "owned_app_ids": [1681430, 3008130],
                    "accessible_app_ids": [1681430, 3008130],
                    "scan_status": "ok",
                    "family_key": "standalone:new-user",
                    "family_member_provider_ids": ["new-user"],
                }
            ],
            "scans": [{"provider_id": "new-user", "status": "ok", "complete": True}],
            "errors": [],
        }

    class FakeOwnershipStore:
        def record_scan(self, inventory):
            return {"attempted": 1, "promoted": 1}

    synced_game_ids = []

    def fake_api(method, url, *, payload=None, timeout=30.0):
        if url.endswith("/admin/pool/roster-status"):
            return {"ok": True}
        if url.endswith("/admin/pool/games/register-steam/1681430"):
            return {"metadata_state": "pending", "game": {"id": 601, "app_id": 1681430}}
        if url.endswith("/admin/pool/games/register-steam/3008130"):
            return {"metadata_state": "pending", "game": {"id": 602, "app_id": 3008130}}
        if url.endswith("/admin/accounts/sync"):
            synced_game_ids.extend(payload["game_ids"])
            return {"ok": True, "account": {"id": 9, "game_ids": payload["game_ids"]}}
        if url.endswith("/admin/pool/families/sync"):
            return {"ok": True}
        raise AssertionError(url)

    monkeypatch.setattr(onboard, "scan_provider_licenses", fake_scan)
    monkeypatch.setattr(onboard, "ProviderOwnershipStore", FakeOwnershipStore)
    monkeypatch.setattr(onboard, "persist_scan_result", lambda value: None)
    monkeypatch.setattr(onboard, "build_family_graph", lambda value: [])
    monkeypatch.setattr(onboard, "_api_json", fake_api)

    result = onboard.onboard_provider_account(
        api="http://127.0.0.1:38147",
        login="new-user",
        password="secret-value",
        accounts_path=path,
        timeout_seconds=42,
    )

    assert result["ok"] is True
    assert synced_game_ids == [601, 602]
    assert result["metadata_pending_count"] == 2
    assert result["unresolved_app_count"] == 0


def test_family_evidence_accumulates_independent_provider_successes() -> None:
    first = {
        "verified_at": "2026-09-04T00:00:00+00:00",
        "scans": [{"provider_id": "provider-001", "status": "ok", "complete": True}],
        "accounts": [{"provider_id": "provider-001", "owned_app_ids": [1], "scan_status": "ok", "family_key": "standalone:provider-001", "family_member_provider_ids": ["provider-001"]}],
    }
    second = {
        "verified_at": "2026-09-08T00:00:00+00:00",
        "scans": [{"provider_id": "provider-002", "status": "ok", "complete": True}],
        "accounts": [{"provider_id": "provider-002", "owned_app_ids": [2, 3], "scan_status": "ok", "family_key": "standalone:provider-002", "family_member_provider_ids": ["provider-002"]}],
    }
    onboard._merge_family_inventory(first, "provider-001")
    merged = onboard._merge_family_inventory(second, "provider-002")
    by_provider = {row["provider_id"]: row for row in merged["accounts"]}
    assert by_provider["provider-001"]["owned_app_ids"] == [1]
    assert by_provider["provider-002"]["owned_app_ids"] == [2, 3]


def test_batch_onboarding_runs_only_explicit_provider_ids(
    tmp_path: Path, monkeypatch
) -> None:
    path = tmp_path / "accFull.csv"
    path.write_text(
        "first,pass-1\nsecond,pass-2\nthird,pass-3\n",
        encoding="utf-8",
    )
    calls: list[tuple[str, str, Path, int]] = []

    def fake_onboard(*, api, login, password, accounts_path, timeout_seconds):
        calls.append((login, password, accounts_path, timeout_seconds))
        return {"ok": True, "provider_id": login, "label": login}

    monkeypatch.setattr(onboard, "onboard_provider_account", fake_onboard)

    result = onboard.onboard_provider_accounts(
        api="http://127.0.0.1:38147",
        provider_ids=["second", "third", "second"],
        accounts_path=path,
        timeout_seconds=55,
    )

    assert result["ok"] is True
    assert result["requested_provider_count"] == 2
    assert result["successful_provider_count"] == 2
    assert result["failed_provider_count"] == 0
    assert calls == [
        ("second", "pass-2", path, 55),
        ("third", "pass-3", path, 55),
    ]
