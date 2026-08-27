"""Verify the complete local Steam pool by asking each remembered account.

This is intentionally an explicit/on-demand operation because it switches the
visible Steam account. For every remembered account it runs Steam's own
``licenses_print`` command, attributes borrowed Family licenses to ``Original
Owner``, deduplicates by (owner, AppID), and restores the account that was active
when verification started.

The resulting cache contains only public Steam identifiers, AppIDs and catalog
metadata. It never stores passwords, Steam Guard secrets, cookies or auth data.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from steam_console_command import run_console_command
from steam_license_inventory import parse_licenses_print, _windows_game_catalog
from steam_pool import active_user_id32, remembered_account_identities
from steam_switch import switch_to_remembered_account

CACHE_DIR = Path(__file__).resolve().parent / ".gameaccess"
CACHE_PATH = CACHE_DIR / "verified_licenses.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def wait_for_active_user(expected_user_id32: int, timeout: float = 45.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if active_user_id32() == expected_user_id32:
            return True
        time.sleep(0.5)
    return False


def _switch(identity: dict[str, Any], attempts: int = 2) -> tuple[bool, str]:
    user_id = identity.get("user_id32")
    if not isinstance(user_id, int):
        return False, "missing user_id32"
    if active_user_id32() == user_id:
        return True, "already active"
    target = str(identity.get("account_name") or identity.get("display_name") or "").strip()
    if not target:
        return False, "missing account label"

    messages: list[str] = []
    for attempt in range(max(1, attempts)):
        result = switch_to_remembered_account(target)
        messages.append(f"attempt {attempt + 1}: {result.stage}: {result.message}")
        if result.ok and wait_for_active_user(user_id):
            # Steam may expose the new ActiveUser before the license table is
            # fully hydrated. Give it a short deterministic settle window.
            time.sleep(2.0)
            return True, result.message
        # A graceful Steam shutdown can legitimately outlive the first timeout.
        # Retry rather than force-killing Steam and potentially killing downloads.
        time.sleep(3.0)
        if active_user_id32() == user_id:
            time.sleep(2.0)
            return True, "account became active during retry wait"
    return False, "; ".join(messages)


def _scan_current(expected_identity: dict[str, Any]) -> dict[str, Any]:
    expected_user = int(expected_identity["user_id32"])
    console = run_console_command(["licenses_print"], 8.0, max_lines=None)
    actual_user = int(console.get("active_user_id32") or 0)
    if actual_user != expected_user:
        raise RuntimeError(f"Steam active user changed during scan: expected {expected_user}, got {actual_user}")
    records = parse_licenses_print(console.get("lines") or [], actual_user)
    return {
        "seat_user_id32": actual_user,
        "seat_label": expected_identity.get("display_name") or expected_identity.get("account_name") or str(actual_user),
        "package_records": len(records),
        "borrowed_package_records": sum(1 for record in records if record.borrowed),
        "console_line_count": int(console.get("line_count") or 0),
        "records": records,
    }


def verify_all_remembered_accounts(*, save: bool = True) -> dict[str, Any]:
    identities = [item for item in remembered_account_identities() if isinstance(item.get("user_id32"), int)]
    if not identities:
        raise RuntimeError("Steam has no remembered account identities")

    original_user = active_user_id32()
    identity_by_user = {int(item["user_id32"]): item for item in identities}
    ordered = sorted(identities, key=lambda item: 0 if item.get("user_id32") == original_user else 1)

    owner_apps_raw: dict[int, set[int]] = {}
    scanned_seats: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    try:
        for identity in ordered:
            user_id = int(identity["user_id32"])
            ok, message = _switch(identity)
            if not ok:
                errors.append({"user_id32": user_id, "label": identity.get("display_name"), "error": message})
                continue
            try:
                scan = _scan_current(identity)
            except Exception as exc:
                errors.append({"user_id32": user_id, "label": identity.get("display_name"), "error": str(exc)})
                continue

            owner_ids_seen: set[int] = set()
            for record in scan.pop("records"):
                owner = record.original_owner_user_id32 if record.borrowed else user_id
                if owner is None:
                    continue
                owner_ids_seen.add(owner)
                owner_apps_raw.setdefault(owner, set()).update(record.apps)
            scan["owners_seen"] = sorted(owner_ids_seen)
            scan["ok"] = True
            scanned_seats.append(scan)
    finally:
        if isinstance(original_user, int) and original_user > 0 and active_user_id32() != original_user:
            original_identity = identity_by_user.get(original_user)
            if original_identity:
                ok, message = _switch(original_identity, attempts=3)
                if not ok:
                    errors.append(
                        {
                            "user_id32": original_user,
                            "label": original_identity.get("display_name"),
                            "error": f"restore failed: {message}",
                        }
                    )

    all_app_ids = {app_id for apps in owner_apps_raw.values() for app_id in apps}
    catalog = _windows_game_catalog(all_app_ids)
    windows_ids = set(catalog)
    owner_apps = {
        owner: {app_id for app_id in apps if app_id in windows_ids}
        for owner, apps in owner_apps_raw.items()
    }

    owners: list[dict[str, Any]] = []
    mappings: list[dict[str, Any]] = []
    for owner, apps in sorted(owner_apps.items(), key=lambda pair: (-len(pair[1]), pair[0])):
        identity = identity_by_user.get(owner) or {}
        label = identity.get("display_name") or identity.get("account_name") or str(owner)
        owners.append(
            {
                "user_id32": owner,
                "steam_id64": identity.get("steam_id64"),
                "label": label,
                "account_name": identity.get("account_name"),
                "remembered": bool(identity),
                "game_count": len(apps),
                "app_ids": sorted(apps),
            }
        )
        for app_id in sorted(apps):
            mappings.append({"owner_user_id32": owner, "app_id": app_id})

    unique_games = {mapping["app_id"] for mapping in mappings}
    scan_errors = [error for error in errors if not str(error.get("error", "")).startswith("restore failed:")]
    result = {
        "ok": bool(scanned_seats),
        "complete": len(scanned_seats) == len(identities) and not scan_errors,
        "source": "steam-console-licenses-print",
        "verified_at": now_iso(),
        "original_active_user_id32": original_user,
        "final_active_user_id32": active_user_id32(),
        "remembered_account_count": len(identities),
        "scanned_account_count": len(scanned_seats),
        "unique_windows_games": len(unique_games),
        "license_mappings": len(mappings),
        "owners": owners,
        "mappings": mappings,
        "games": [
            {
                "app_id": app_id,
                "name": catalog[app_id].get("name") or str(app_id),
                "developer": catalog[app_id].get("developer") or "",
                "publisher": catalog[app_id].get("publisher") or "",
            }
            for app_id in sorted(unique_games)
        ],
        "scanned_seats": scanned_seats,
        "errors": errors,
    }
    if save:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def load_verified_inventory() -> dict[str, Any] | None:
    if not CACHE_PATH.is_file():
        return None
    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify all remembered Steam licenses using licenses_print")
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--no-save", action="store_true")
    args = parser.parse_args()
    result = verify_all_remembered_accounts(save=not args.no_save)
    if args.compact:
        result = {
            "ok": result["ok"],
            "complete": result["complete"],
            "source": result["source"],
            "verified_at": result["verified_at"],
            "original_active_user_id32": result["original_active_user_id32"],
            "final_active_user_id32": result["final_active_user_id32"],
            "remembered_account_count": result["remembered_account_count"],
            "scanned_account_count": result["scanned_account_count"],
            "unique_windows_games": result["unique_windows_games"],
            "license_mappings": result["license_mappings"],
            "owners": [
                {"user_id32": o["user_id32"], "label": o["label"], "remembered": o["remembered"], "game_count": o["game_count"]}
                for o in result["owners"]
            ],
            "scanned_seats": result["scanned_seats"],
            "errors": result["errors"],
        }
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
