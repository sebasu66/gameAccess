from __future__ import annotations

import json
from pathlib import Path

import provider_license_scan as scan


def _inventory(*, complete: bool, app_id: int) -> dict:
    return {
        "source": "steamkit-license-list-pics",
        "verified_at": "2026-09-04T00:00:00+00:00",
        "complete": complete,
        "full_coverage": complete,
        "roster_count": 2,
        "scanned_provider_count": 2 if complete else 1,
        "successful_scan_count": 2 if complete else 1,
        "error_count": 0,
        "unmapped_owner_count": 0,
        "accounts": [
            {
                "provider_id": "provider-001",
                "owned_app_ids": [app_id],
                "scan_status": "ok",
            },
            {
                "provider_id": "provider-002",
                "owned_app_ids": [] if complete else [],
                "scan_status": "ok" if complete else "not_scanned",
            },
        ],
        "scans": [],
        "errors": [],
    }


def test_incomplete_scan_cannot_overwrite_authoritative_snapshot(tmp_path: Path, monkeypatch) -> None:
    authoritative = tmp_path / "provider_licenses.json"
    monkeypatch.setattr(scan, "DEFAULT_OUTPUT", authoritative)
    original = _inventory(complete=True, app_id=100)
    authoritative.write_text(json.dumps(original), encoding="utf-8")

    saved = scan.save_provider_license_inventory(
        _inventory(complete=False, app_id=200),
        authoritative,
        allow_incomplete=True,
    )

    assert saved is False
    assert json.loads(authoritative.read_text(encoding="utf-8")) == original


def test_partial_scan_defaults_to_diagnostic_snapshot(tmp_path: Path, monkeypatch) -> None:
    authoritative = tmp_path / "provider_licenses.json"
    diagnostic = tmp_path / "provider_licenses.last_scan.json"
    monkeypatch.setattr(scan, "DEFAULT_OUTPUT", authoritative)
    monkeypatch.setattr(scan, "DEFAULT_DIAGNOSTIC_OUTPUT", diagnostic)

    result = scan.persist_scan_result(_inventory(complete=False, app_id=200))

    assert result["saved"] is True
    assert result["authoritative_updated"] is False
    assert Path(result["output"]) == diagnostic
    assert diagnostic.is_file()
    assert not authoritative.exists()


def test_complete_full_scan_updates_authoritative_snapshot(tmp_path: Path, monkeypatch) -> None:
    authoritative = tmp_path / "provider_licenses.json"
    diagnostic = tmp_path / "provider_licenses.last_scan.json"
    monkeypatch.setattr(scan, "DEFAULT_OUTPUT", authoritative)
    monkeypatch.setattr(scan, "DEFAULT_DIAGNOSTIC_OUTPUT", diagnostic)

    inventory = _inventory(complete=True, app_id=300)
    result = scan.persist_scan_result(inventory)

    assert result["saved"] is True
    assert result["authoritative_updated"] is True
    assert Path(result["output"]) == authoritative
    assert json.loads(authoritative.read_text(encoding="utf-8")) == inventory
    assert not diagnostic.exists()


def test_require_complete_rejects_partial_snapshot(tmp_path: Path) -> None:
    path = tmp_path / "partial.json"
    path.write_text(json.dumps(_inventory(complete=False, app_id=400)), encoding="utf-8")

    assert scan.load_provider_license_inventory(path) is not None
    assert scan.load_provider_license_inventory(path, require_complete=True) is None
