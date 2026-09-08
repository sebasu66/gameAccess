"""Add or update one Steam provider and synchronize only that account.

Credentials are passed through environment variables so they never appear in
process arguments or task logs. The account is written to the configured
``accFull.csv`` roster, scanned with the existing SteamKit license scanner, and
then only that provider's verified games are imported/synchronized to the API.
Existing accounts are never Steam-rescanned by this workflow.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
from typing import Any

import requests
from family_refresh import build_family_graph
from provider_family_evidence import merge_family_evidence
from provider_license_scan import (
    DEFAULT_OUTPUT,
    load_provider_license_inventory,
    persist_scan_result,
    scan_provider_licenses,
)
from provider_roster import (
    ProviderCredential,
    configured_accounts_path,
    load_provider_credentials,
)

USER_ENV = "GAMEACCESS_PROVIDER_ACCOUNT_USER"
PASSWORD_ENV = "GAMEACCESS_PROVIDER_ACCOUNT_PASSWORD"


def _read_rows(path: Path) -> list[list[str]]:
    if not path.is_file():
        return []
    with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
        return [list(row) for row in csv.reader(handle)]


def upsert_provider_credentials(
    path: Path,
    login: str,
    password: str,
) -> tuple[ProviderCredential, bool]:
    """Persist one credential atomically while keeping provider ordering stable."""
    login = login.strip()
    if not login:
        raise ValueError("Steam account name is required")
    if not password:
        raise ValueError("Steam password is required")

    path = Path(path)
    rows = _read_rows(path)
    updated = False
    created = True
    for row in rows:
        if len(row) < 2:
            continue
        current_login = str(row[0]).strip()
        current_password = str(row[1]).strip()
        if current_login.casefold() in {
            "usr",
            "user",
            "username",
            "login",
        } and current_password.casefold() in {"pass", "password"}:
            continue
        if current_login.casefold() == login.casefold():
            row[0] = login
            row[1] = password
            updated = True
            created = False
            break
    if not updated:
        rows.append([login, password])

    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.name}.tmp")
    with temp.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerows(rows)
    temp.replace(path)

    credential = next(
        (
            item
            for item in load_provider_credentials(path)
            if item.login.casefold() == login.casefold()
        ),
        None,
    )
    if credential is None:
        raise RuntimeError(
            "The provider credential was written but could not be reloaded"
        )
    return credential, created


def _api_json(
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> Any:
    response = requests.request(method, url, json=payload, timeout=timeout)
    response.raise_for_status()
    if not response.content:
        return None
    return response.json()


def _selected_scan(
    inventory: dict[str, Any], provider_id: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    scan = next(
        (
            item
            for item in inventory.get("scans", [])
            if str(item.get("provider_id") or "") == provider_id
        ),
        None,
    )
    account = next(
        (
            item
            for item in inventory.get("accounts", [])
            if str(item.get("provider_id") or "") == provider_id
        ),
        None,
    )
    if not isinstance(scan, dict) or not isinstance(account, dict):
        raise RuntimeError(f"SteamKit returned no result for {provider_id}")
    return scan, account


def _import_verified_games(api: str, app_ids: list[int]) -> tuple[list[int], list[int]]:
    """Return imported backend game IDs and unresolved AppIDs."""
    imported_game_ids: list[int] = []
    unresolved_app_ids: list[int] = []
    base = api.rstrip("/")
    for app_id in sorted(set(app_ids)):
        try:
            metadata = _api_json("GET", f"{base}/steam/apps/{app_id}", timeout=20.0)
        except Exception:
            unresolved_app_ids.append(app_id)
            continue
        if not isinstance(metadata, dict):
            unresolved_app_ids.append(app_id)
            continue
        if str(metadata.get("type") or "").casefold() != "game" or not bool(
            metadata.get("windows")
        ):
            continue
        try:
            imported = _api_json(
                "POST", f"{base}/admin/games/import-steam/{app_id}", timeout=20.0
            )
        except Exception:
            unresolved_app_ids.append(app_id)
            continue
        game = imported.get("game") if isinstance(imported, dict) else None
        game_id = game.get("id") if isinstance(game, dict) else None
        if isinstance(game_id, int) and game_id > 0:
            imported_game_ids.append(game_id)
        else:
            unresolved_app_ids.append(app_id)
    return imported_game_ids, unresolved_app_ids


def _merge_family_inventory(
    partial: dict[str, Any], provider_id: str
) -> dict[str, Any]:
    authoritative = load_provider_license_inventory(
        DEFAULT_OUTPUT, require_complete=True
    )
    return merge_family_evidence(
        authoritative or {},
        partial,
        DEFAULT_OUTPUT.with_name("provider_family_evidence.db"),
        selected={provider_id},
    )


def onboard_provider_account(
    *,
    api: str,
    login: str,
    password: str,
    accounts_path: Path | None = None,
    timeout_seconds: int = 70,
) -> dict[str, Any]:
    source = Path(accounts_path) if accounts_path else configured_accounts_path()
    credential, created = upsert_provider_credentials(source, login, password)
    base = api.rstrip("/")

    # Refresh the API's in-memory credential cache immediately; no restart needed.
    _api_json("GET", f"{base}/admin/pool/roster-status", timeout=20.0)

    print(f"STATE=scanning:{credential.provider_id}", flush=True)
    inventory = scan_provider_licenses(
        provider_ids={credential.provider_id},
        timeout_seconds=timeout_seconds,
    )
    persist_scan_result(inventory)
    scan, account = _selected_scan(inventory, credential.provider_id)
    scan_ok = str(scan.get("status") or "") == "ok" and bool(scan.get("complete"))
    if not scan_ok:
        error = next(
            (
                item
                for item in inventory.get("errors", [])
                if str(item.get("provider_id") or "") == credential.provider_id
            ),
            {},
        )
        return {
            "ok": False,
            "created": created,
            "provider_id": credential.provider_id,
            "label": credential.label,
            "scan_status": scan.get("status"),
            "scan_complete": bool(scan.get("complete")),
            "error": str(error.get("error") or scan.get("status") or "scan failed")[
                :500
            ],
            "guard_method": error.get("guard_method"),
        }

    owned_app_ids = sorted(
        {
            int(app_id)
            for app_id in account.get("owned_app_ids") or []
            if str(app_id).isdigit() and int(app_id) > 0
        }
    )
    accessible_app_ids = sorted(
        {
            int(app_id)
            for app_id in account.get("accessible_app_ids", [])
            if str(app_id).isdigit() and int(app_id) > 0
        }
    )
    print(f"STATE=metadata:{len(owned_app_ids)}", flush=True)
    game_ids, unresolved_app_ids = _import_verified_games(base, owned_app_ids)

    notes = json.dumps(
        {
            "source": "provider-account-onboard",
            "account_name": credential.login,
            "provider_id": credential.provider_id,
            "ownership_source": inventory.get("source") or "steamkit-license-list-pics",
            "ownership_verified_at": inventory.get("verified_at"),
            "inventory_complete": True,
            "ownership_scan_status": "ok",
            "owned_app_count": len(owned_app_ids),
            "accessible_app_ids": accessible_app_ids,
            "accessible_app_count": len(accessible_app_ids),
            "imported_game_count": len(game_ids),
            "unresolved_app_count": len(unresolved_app_ids),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    synced = _api_json(
        "POST",
        f"{base}/admin/accounts/sync",
        payload={
            "label": credential.label,
            "provider": "steam",
            "game_ids": game_ids,
            "notes": notes,
        },
        timeout=30.0,
    )

    # Preserve earlier partial successes when rebuilding family capacity.
    # This performs no Steam login or scan for existing accounts.
    merged_inventory = _merge_family_inventory(inventory, credential.provider_id)
    families = build_family_graph(merged_inventory)
    family_sync = _api_json(
        "POST",
        f"{base}/admin/pool/families/sync",
        payload={"families": families},
        timeout=30.0,
    )

    print("STATE=done", flush=True)
    return {
        "ok": True,
        "created": created,
        "provider_id": credential.provider_id,
        "label": credential.label,
        "owned_app_count": len(owned_app_ids),
        "accessible_app_count": len(accessible_app_ids),
        "catalog_game_count": len(game_ids),
        "unresolved_app_count": len(unresolved_app_ids),
        "unresolved_app_ids": unresolved_app_ids[:25],
        "account": synced.get("account") if isinstance(synced, dict) else None,
        "family_count": len(families),
        "family_sync": family_sync,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Add/update and scan one GameAccess Steam provider"
    )
    parser.add_argument("--api", default="http://127.0.0.1:38147")
    parser.add_argument("--accounts-file")
    parser.add_argument("--timeout-seconds", type=int, default=70)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()

    login = os.environ.get(USER_ENV, "").strip()
    password = os.environ.get(PASSWORD_ENV, "")
    if not login or not password:
        print(
            json.dumps(
                {"ok": False, "error": f"{USER_ENV} and {PASSWORD_ENV} are required"}
            )
        )
        return 2

    try:
        result = onboard_provider_account(
            api=args.api,
            login=login,
            password=password,
            accounts_path=Path(args.accounts_file) if args.accounts_file else None,
            timeout_seconds=max(15, min(args.timeout_seconds, 180)),
        )
    except Exception as exc:
        print("STATE=error", flush=True)
        print(json.dumps({"ok": False, "error": str(exc)[:1000]}, ensure_ascii=False))
        return 1

    print(
        json.dumps(result, ensure_ascii=False)
        if args.compact
        else json.dumps(result, ensure_ascii=False, indent=2)
    )
    return 0 if result.get("ok") else 3


if __name__ == "__main__":
    raise SystemExit(main())
