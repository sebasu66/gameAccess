from __future__ import annotations

import provider_download_manager
import provider_download_probe


def test_verified_provider_ids_follow_shared_backend_ownership_state(monkeypatch):
    monkeypatch.setattr(
        provider_download_probe,
        "_ownership_state_by_provider",
        lambda: (
            {
                "provider-001": {
                    "owned_app_ids": {111},
                    "inventory_complete": True,
                    "scan_status": "ok",
                },
                "provider-002": {
                    "owned_app_ids": {222, 333},
                    "inventory_complete": True,
                    "scan_status": "ok",
                },
                "provider-003": {
                    "owned_app_ids": {222},
                    "inventory_complete": False,
                    "scan_status": "error",
                },
            },
            {"source": "steamkit-license-list-pics"},
        ),
    )

    assert provider_download_probe.verified_provider_ids_for_app(222) == [
        "provider-002"
    ]


def test_provider_candidates_use_shared_verified_ownership(monkeypatch):
    monkeypatch.setattr(
        provider_download_probe,
        "_ownership_state_by_provider",
        lambda: (
            {
                "provider-002": {
                    "owned_app_ids": {222, 444},
                    "inventory_complete": True,
                    "scan_status": "ok",
                }
            },
            {},
        ),
    )
    monkeypatch.setattr(
        provider_download_probe,
        "build_provider_catalog",
        lambda **_: {
            "games": [
                {"app_id": 222, "name": "Owned Game"},
                {"app_id": 555, "name": "Not Owned"},
            ]
        },
    )

    assert provider_download_probe.provider_candidates("provider-002") == [
        {"app_id": 222, "name": "Owned Game"}
    ]


def test_provider_candidates_request_metadata_for_hidden_verified_game(monkeypatch):
    monkeypatch.setattr(provider_download_probe, "verified_owned_ids", lambda _: {222, 444})
    requested: dict[str, object] = {}

    def build_provider_catalog(**kwargs):
        requested.update(kwargs)
        return {
            "games": [
                {"app_id": 222, "name": "Visible Game"},
                {"app_id": 444, "name": "Hidden But Licensed"},
            ]
        }

    monkeypatch.setattr(provider_download_probe, "build_provider_catalog", build_provider_catalog)

    candidates = provider_download_probe.provider_candidates("provider-002")
    assert requested["additional_candidate_ids"] == {222, 444}
    assert [item["app_id"] for item in candidates] == [444, 222]


def test_download_manager_selects_provider_reported_by_shared_state(monkeypatch):
    monkeypatch.setattr(
        provider_download_manager,
        "verified_provider_ids_for_app",
        lambda app_id: ["provider-002"] if app_id == 222 else [],
    )
    monkeypatch.setattr(
        provider_download_manager,
        "provider_candidates",
        lambda provider_id: (
            [{"app_id": 222, "name": "Owned Game"}]
            if provider_id == "provider-002"
            else []
        ),
    )

    assert provider_download_manager.verified_provider_for_app(222) == "provider-002"


def test_download_validation_reuses_existing_verified_owner_before_scanning(monkeypatch):
    monkeypatch.setattr(
        provider_download_manager,
        "verified_provider_for_app",
        lambda app_id: "provider-009" if app_id == 999 else (_ for _ in ()).throw(RuntimeError()),
    )

    def fail_scan(*args, **kwargs):
        raise AssertionError("license scan should not run when verified ownership already exists")

    monkeypatch.setattr(provider_download_manager, "scan_provider_licenses", fail_scan)
    assert provider_download_manager.refresh_original_owner_for_app(999) == "provider-009"
