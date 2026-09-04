from __future__ import annotations

import json

import pool_sync


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_older_diagnostic_does_not_override_newer_complete_inventory(tmp_path, monkeypatch):
    authoritative = tmp_path / "provider_licenses.json"
    diagnostic = tmp_path / "provider_licenses.last_scan.json"
    _write(authoritative, {
        "source": "steamkit-license-list-pics",
        "verified_at": "2026-09-04T20:06:15+00:00",
        "complete": True,
        "accounts": [{"provider_id": "provider-004", "owned_app_ids": [730]}],
        "scans": [{"provider_id": "provider-004", "status": "ok", "complete": True}],
        "errors": [],
    })
    _write(diagnostic, {
        "source": "steamkit-license-list-pics",
        "verified_at": "2026-09-04T18:21:14+00:00",
        "complete": False,
        "accounts": [{"provider_id": "provider-004", "owned_app_ids": []}],
        "scans": [{"provider_id": "provider-004", "status": "logon_error", "complete": False}],
        "errors": [{"provider_id": "provider-004", "error": "AlreadyLoggedInElsewhere"}],
    })
    monkeypatch.setattr(pool_sync, "LICENSE_OUTPUT", authoritative)
    monkeypatch.setattr(pool_sync, "DEFAULT_DIAGNOSTIC_OUTPUT", diagnostic)

    state, metadata = pool_sync._ownership_state_by_provider()

    assert state["provider-004"]["scan_status"] == "ok"
    assert state["provider-004"]["owned_app_ids"] == {730}
    assert metadata["verified_at"] == "2026-09-04T20:06:15+00:00"
    assert metadata["verification_errors"] == []


def test_newer_diagnostic_can_overlay_successful_provider(tmp_path, monkeypatch):
    authoritative = tmp_path / "provider_licenses.json"
    diagnostic = tmp_path / "provider_licenses.last_scan.json"
    _write(authoritative, {
        "source": "steamkit-license-list-pics",
        "verified_at": "2026-09-04T18:00:00+00:00",
        "complete": True,
        "accounts": [{"provider_id": "provider-001", "owned_app_ids": [10]}],
        "scans": [{"provider_id": "provider-001", "status": "ok", "complete": True}],
        "errors": [],
    })
    _write(diagnostic, {
        "source": "steamkit-license-list-pics",
        "verified_at": "2026-09-04T19:00:00+00:00",
        "complete": False,
        "accounts": [{"provider_id": "provider-001", "owned_app_ids": [10, 20]}],
        "scans": [{"provider_id": "provider-001", "status": "ok", "complete": True}],
        "errors": [],
    })
    monkeypatch.setattr(pool_sync, "LICENSE_OUTPUT", authoritative)
    monkeypatch.setattr(pool_sync, "DEFAULT_DIAGNOSTIC_OUTPUT", diagnostic)

    state, metadata = pool_sync._ownership_state_by_provider()

    assert state["provider-001"]["owned_app_ids"] == {10, 20}
    assert metadata["verified_at"] == "2026-09-04T19:00:00+00:00"
