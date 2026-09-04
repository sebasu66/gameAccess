from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"expected block not found in {path}: {old[:160]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


pool_sync = ROOT / "apps" / "launcher" / "pool_sync.py"
replace_once(
    pool_sync,
    "import argparse\nimport json\nfrom pathlib import Path\n",
    "import argparse\nimport json\nfrom datetime import datetime, timezone\nfrom pathlib import Path\n",
)
replace_once(
    pool_sync,
    '''def _owned_ids(account: dict[str, Any] | None) -> set[int]:\n    if not account:\n        return set()\n    return {\n        int(app_id)\n        for app_id in account.get("owned_app_ids") or []\n        if str(app_id).isdigit() and int(app_id) > 0\n    }\n\n\ndef _ownership_state_by_provider() -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:\n''',
    '''def _owned_ids(account: dict[str, Any] | None) -> set[int]:\n    if not account:\n        return set()\n    return {\n        int(app_id)\n        for app_id in account.get("owned_app_ids") or []\n        if str(app_id).isdigit() and int(app_id) > 0\n    }\n\n\ndef _inventory_time(inventory: dict[str, Any] | None) -> datetime:\n    raw = str((inventory or {}).get("verified_at") or "").strip()\n    if not raw:\n        return datetime.min.replace(tzinfo=timezone.utc)\n    try:\n        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))\n        if parsed.tzinfo is None:\n            parsed = parsed.replace(tzinfo=timezone.utc)\n        return parsed.astimezone(timezone.utc)\n    except ValueError:\n        return datetime.min.replace(tzinfo=timezone.utc)\n\n\ndef _ownership_state_by_provider() -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:\n''',
)
replace_once(
    pool_sync,
    '''    latest = diagnostic if diagnostic else authoritative\n    if diagnostic:\n        accounts = _account_rows(diagnostic)\n''',
    '''    # Diagnostic snapshots are useful only when they are newer than the\n    # complete authoritative inventory. An old failed batch must never override\n    # a later successful full-roster scan.\n    diagnostic_is_newer = bool(\n        diagnostic\n        and (not authoritative or _inventory_time(diagnostic) > _inventory_time(authoritative))\n    )\n    latest = diagnostic if diagnostic_is_newer else authoritative\n    if diagnostic_is_newer and diagnostic:\n        accounts = _account_rows(diagnostic)\n''',
)

provider_scan = ROOT / "apps" / "launcher" / "provider_license_scan.py"
replace_once(
    provider_scan,
    '''    family_key_by_provider: dict[str, str] = {}\n    family_members_by_provider: dict[str, list[str]] = {}\n\n    for credential in selected:\n''',
    '''    family_key_by_provider: dict[str, str] = {}\n    family_members_by_provider: dict[str, list[str]] = {}\n    scanned_steam64_by_provider: dict[str, str] = {}\n    raw_family_member_steam_ids_by_provider: dict[str, list[str]] = {}\n\n    for credential in selected:\n''',
)
replace_once(
    provider_scan,
    '''            scanner_steam64 = str(result.get("steam_id64") or "")\n            if scanner_steam64.isdigit():\n                provider_by_steam64[scanner_steam64] = credential.provider_id\n''',
    '''            scanner_steam64 = str(result.get("steam_id64") or "")\n            if scanner_steam64.isdigit():\n                provider_by_steam64[scanner_steam64] = credential.provider_id\n                scanned_steam64_by_provider[credential.provider_id] = scanner_steam64\n''',
)
replace_once(
    provider_scan,
    '''            if is_standalone:\n                family_key = f"standalone:{credential.provider_id}"\n                family_member_provider_ids = [credential.provider_id]\n            else:\n                digest = hashlib.sha256(f"steam-family:{family_group_id}".encode("utf-8")).hexdigest()[:24]\n                family_key = f"steam-family:{digest}"\n                family_member_provider_ids = sorted(\n                    {\n                        provider_by_steam64[str(steam_id)]\n                        for steam_id in result.get("family_member_steam_ids") or []\n                        if str(steam_id) in provider_by_steam64\n                    }\n                    | {credential.provider_id}\n                )\n            family_key_by_provider[credential.provider_id] = family_key\n            family_members_by_provider[credential.provider_id] = family_member_provider_ids\n''',
    '''            if is_standalone:\n                family_key = f"standalone:{credential.provider_id}"\n                family_member_provider_ids = [credential.provider_id]\n                raw_family_member_steam_ids_by_provider[credential.provider_id] = [scanner_steam64] if scanner_steam64 else []\n            else:\n                digest = hashlib.sha256(f"steam-family:{family_group_id}".encode("utf-8")).hexdigest()[:24]\n                family_key = f"steam-family:{digest}"\n                raw_family_member_steam_ids_by_provider[credential.provider_id] = [\n                    str(steam_id)\n                    for steam_id in result.get("family_member_steam_ids") or []\n                    if str(steam_id).isdigit()\n                ]\n                # Resolve once now for diagnostics; a complete second pass below\n                # repeats this after every scanned provider SteamID is known.\n                family_member_provider_ids = sorted(\n                    {\n                        provider_by_steam64[str(steam_id)]\n                        for steam_id in raw_family_member_steam_ids_by_provider[credential.provider_id]\n                        if str(steam_id) in provider_by_steam64\n                    }\n                    | {credential.provider_id}\n                )\n            family_key_by_provider[credential.provider_id] = family_key\n            family_members_by_provider[credential.provider_id] = family_member_provider_ids\n''',
)
replace_once(
    provider_scan,
    '''    scanned_ids = {scan["provider_id"] for scan in scans}\n    all_provider_ids = {credential.provider_id for credential in credentials}\n''',
    '''    # Resolve family members only after all account scans have completed.\n    # This avoids missing a sibling merely because its own SteamID was learned\n    # later in the scan order. Raw SteamIDs remain local/ephemeral and are not\n    # persisted in the inventory.\n    final_provider_by_steam64 = dict(provider_by_steam64)\n    final_provider_by_steam64.update(\n        {steam64: provider_id for provider_id, steam64 in scanned_steam64_by_provider.items()}\n    )\n    scan_by_provider = {str(scan.get("provider_id")): scan for scan in scans}\n    for provider_id, family_key in family_key_by_provider.items():\n        if family_key.startswith("standalone:"):\n            members = [provider_id]\n        else:\n            members = sorted(\n                {\n                    final_provider_by_steam64[steam64]\n                    for steam64 in raw_family_member_steam_ids_by_provider.get(provider_id, [])\n                    if steam64 in final_provider_by_steam64\n                }\n                | {provider_id}\n            )\n        family_members_by_provider[provider_id] = members\n        scan = scan_by_provider.get(provider_id)\n        if scan is not None:\n            scan["family_member_count"] = len(members)\n\n    scanned_ids = {scan["provider_id"] for scan in scans}\n    all_provider_ids = {credential.provider_id for credential in credentials}\n''',
)

# Tests for inventory freshness and the no-regression family helper behavior.
test_path = ROOT / "apps" / "launcher" / "test_inventory_freshness.py"
test_path.write_text('''from __future__ import annotations\n\nimport json\n\nimport pool_sync\n\n\ndef _write(path, payload):\n    path.parent.mkdir(parents=True, exist_ok=True)\n    path.write_text(json.dumps(payload), encoding="utf-8")\n\n\ndef test_older_diagnostic_does_not_override_newer_complete_inventory(tmp_path, monkeypatch):\n    authoritative = tmp_path / "provider_licenses.json"\n    diagnostic = tmp_path / "provider_licenses.last_scan.json"\n    _write(authoritative, {\n        "source": "steamkit-license-list-pics",\n        "verified_at": "2026-09-04T20:06:15+00:00",\n        "complete": True,\n        "accounts": [{"provider_id": "provider-004", "owned_app_ids": [730]}],\n        "scans": [{"provider_id": "provider-004", "status": "ok", "complete": True}],\n        "errors": [],\n    })\n    _write(diagnostic, {\n        "source": "steamkit-license-list-pics",\n        "verified_at": "2026-09-04T18:21:14+00:00",\n        "complete": False,\n        "accounts": [{"provider_id": "provider-004", "owned_app_ids": []}],\n        "scans": [{"provider_id": "provider-004", "status": "logon_error", "complete": False}],\n        "errors": [{"provider_id": "provider-004", "error": "AlreadyLoggedInElsewhere"}],\n    })\n    monkeypatch.setattr(pool_sync, "LICENSE_OUTPUT", authoritative)\n    monkeypatch.setattr(pool_sync, "DEFAULT_DIAGNOSTIC_OUTPUT", diagnostic)\n\n    state, metadata = pool_sync._ownership_state_by_provider()\n\n    assert state["provider-004"]["scan_status"] == "ok"\n    assert state["provider-004"]["owned_app_ids"] == {730}\n    assert metadata["verified_at"] == "2026-09-04T20:06:15+00:00"\n    assert metadata["verification_errors"] == []\n\n\ndef test_newer_diagnostic_can_overlay_successful_provider(tmp_path, monkeypatch):\n    authoritative = tmp_path / "provider_licenses.json"\n    diagnostic = tmp_path / "provider_licenses.last_scan.json"\n    _write(authoritative, {\n        "source": "steamkit-license-list-pics",\n        "verified_at": "2026-09-04T18:00:00+00:00",\n        "complete": True,\n        "accounts": [{"provider_id": "provider-001", "owned_app_ids": [10]}],\n        "scans": [{"provider_id": "provider-001", "status": "ok", "complete": True}],\n        "errors": [],\n    })\n    _write(diagnostic, {\n        "source": "steamkit-license-list-pics",\n        "verified_at": "2026-09-04T19:00:00+00:00",\n        "complete": False,\n        "accounts": [{"provider_id": "provider-001", "owned_app_ids": [10, 20]}],\n        "scans": [{"provider_id": "provider-001", "status": "ok", "complete": True}],\n        "errors": [],\n    })\n    monkeypatch.setattr(pool_sync, "LICENSE_OUTPUT", authoritative)\n    monkeypatch.setattr(pool_sync, "DEFAULT_DIAGNOSTIC_OUTPUT", diagnostic)\n\n    state, metadata = pool_sync._ownership_state_by_provider()\n\n    assert state["provider-001"]["owned_app_ids"] == {10, 20}\n    assert metadata["verified_at"] == "2026-09-04T19:00:00+00:00"\n''', encoding="utf-8")

print("inventory freshness and two-pass family resolution patch applied")
