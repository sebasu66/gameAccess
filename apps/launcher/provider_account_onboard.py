"""Add or update Steam providers and synchronize selected accounts.

SteamKit ownership is authoritative and is persisted before any Steam Store
metadata is required. Store enrichment is scheduled independently by the API,
so metadata failures cannot remove a verified AppID from an account.
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
from provider_license_scan import persist_scan_result, scan_provider_licenses
from provider_ownership_store import DEFAULT_STORE, ProviderOwnershipStore
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


def _persist_failed_scan_account(
    api: str, credential: ProviderCredential, inventory: dict[str, Any],
    scan: dict[str, Any], error_text: str,
) -> dict[str, Any] | None:
    """Keep a failed/temporary provider visible without erasing old licenses."""
    base = api.rstrip("/")
    existing_accounts = _api_json("GET", f"{base}/admin/accounts", timeout=20.0) or []
    existing = next(
        (row for row in existing_accounts if str(row.get("label") or "") == credential.label),
        None,
    )
    game_ids = [
        int(game["id"])
        for game in ((existing or {}).get("games") or [])
        if isinstance(game, dict) and isinstance(game.get("id"), int)
    ]
    notes = json.dumps(
        {
            "source": "provider-account-onboard",
            "account_name": credential.login,
            "provider_id": credential.provider_id,
            "ownership_source": inventory.get("source") or "steamkit-license-list-pics",
            "ownership_verified_at": inventory.get("verified_at"),
            "inventory_complete": False,
            "ownership_scan_status": str(scan.get("status") or "error"),
            "ownership_scan_error": error_text[:500],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return _api_json(
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


def _register_verified_apps(
    api: str, app_ids: list[int]
) -> tuple[list[int], list[int], list[int]]:
    """Register verified AppIDs without waiting for Store metadata.

    The API creates a stable inactive placeholder immediately and schedules
    metadata enrichment after the response. The returned game ID can therefore
    be mapped to the provider even when Steam Store is rate-limited.
    """
    game_ids: list[int] = []
    unresolved_app_ids: list[int] = []
    metadata_pending_app_ids: list[int] = []
    base = api.rstrip("/")
    for app_id in sorted(set(app_ids)):
        try:
            registered = _api_json(
                "POST",
                f"{base}/admin/pool/games/register-steam/{app_id}",
                timeout=20.0,
            )
        except Exception:
            unresolved_app_ids.append(app_id)
            continue
        game = registered.get("game") if isinstance(registered, dict) else None
        game_id = game.get("id") if isinstance(game, dict) else None
        if not isinstance(game_id, int) or game_id <= 0:
            unresolved_app_ids.append(app_id)
            continue
        game_ids.append(game_id)
        if str(registered.get("metadata_state") or "pending") == "pending":
            metadata_pending_app_ids.append(app_id)
    return game_ids, unresolved_app_ids, metadata_pending_app_ids


def _merge_family_inventory(
    partial: dict[str, Any], provider_id: str
) -> dict[str, Any]:
    return merge_family_evidence(
        {},
        partial,
        DEFAULT_STORE.with_name("provider_family_evidence.db"),
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
    ownership_update = ProviderOwnershipStore().record_scan(inventory)
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
        error_text = str(error.get("error") or scan.get("status") or "scan failed")[:500]
        persistence_error = None
        try:
            _persist_failed_scan_account(base, credential, inventory, scan, error_text)
        except Exception as exc:
            persistence_error = f"{type(exc).__name__}: {exc}"[:500]
        return {
            "ok": False,
            "created": created,
            "provider_id": credential.provider_id,
            "label": credential.label,
            "scan_status": scan.get("status"),
            "scan_complete": bool(scan.get("complete")),
            "error": error_text,
            "guard_method": error.get("guard_method"),
            "account_status_persistence_error": persistence_error,
        }

    # Phase 1 is now complete before Store enrichment begins. These AppIDs are
    # the authoritative SteamKit ownership/access result for this provider.
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

    # Phase 2 only registers AppID identities in the backend. Each API response
    # returns before its independent background Store enrichment completes.
    print(f"STATE=registering:{len(accessible_app_ids)}", flush=True)
    owned_game_ids, owned_unresolved, owned_pending = _register_verified_apps(
        base, owned_app_ids
    )
    shared_game_ids, shared_unresolved, shared_pending = _register_verified_apps(
        base, sorted(set(accessible_app_ids) - set(owned_app_ids))
    )
    game_ids = sorted(set(owned_game_ids + shared_game_ids))
    unresolved_app_ids = sorted(set(owned_unresolved + shared_unresolved))
    metadata_pending_app_ids = sorted(set(owned_pending + shared_pending))

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
            "registered_app_count": len(game_ids),
            "metadata_enrichment": "server-background",
            "metadata_pending_count": len(metadata_pending_app_ids),
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
    # This performs no Steam login or Store metadata request for other accounts.
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
        "registered_app_count": len(game_ids),
        # Keep the older field for callers; it now means AppIDs registered in
        # the backend, not metadata requests that happened to succeed.
        "catalog_game_count": len(game_ids),
        "accessible_catalog_game_count": len(game_ids),
        "metadata_pending_count": len(metadata_pending_app_ids),
        "ownership_promoted": ownership_update["promoted"],
        "unresolved_app_count": len(unresolved_app_ids),
        "unresolved_app_ids": unresolved_app_ids[:25],
        "account": synced.get("account") if isinstance(synced, dict) else None,
        "family_count": len(families),
        "family_sync": family_sync,
    }


def onboard_provider_accounts(
    *,
    api: str,
    provider_ids: list[str],
    accounts_path: Path | None = None,
    timeout_seconds: int = 70,
) -> dict[str, Any]:
    """Run the one-account ownership flow for an explicit provider list."""
    requested = list(
        dict.fromkeys(
            provider_id.strip() for provider_id in provider_ids if provider_id.strip()
        )
    )
    if not requested:
        raise ValueError("At least one --provider-id is required")

    source = Path(accounts_path) if accounts_path else configured_accounts_path()
    credentials = {
        credential.provider_id: credential
        for credential in load_provider_credentials(source)
    }
    missing = [provider_id for provider_id in requested if provider_id not in credentials]
    if missing:
        raise RuntimeError(
            "Provider account(s) not found in accFull.csv: " + ", ".join(missing)
        )

    results: list[dict[str, Any]] = []
    for index, provider_id in enumerate(requested, start=1):
        credential = credentials[provider_id]
        print(f"STATE=batch:{index}/{len(requested)}:{provider_id}", flush=True)
        try:
            result = onboard_provider_account(
                api=api,
                login=credential.login,
                password=credential.password,
                accounts_path=source,
                timeout_seconds=timeout_seconds,
            )
        except Exception as exc:
            result = {
                "ok": False,
                "provider_id": provider_id,
                "label": credential.label,
                "error": f"{type(exc).__name__}: {exc}"[:500],
            }
        results.append(result)

    succeeded = sum(1 for result in results if result.get("ok"))
    return {
        "ok": succeeded == len(results),
        "requested_provider_count": len(requested),
        "successful_provider_count": succeeded,
        "failed_provider_count": len(results) - succeeded,
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Add/update and scan one or more GameAccess Steam providers"
    )
    parser.add_argument("--api", default="http://127.0.0.1:38147")
    parser.add_argument("--accounts-file")
    parser.add_argument("--timeout-seconds", type=int, default=70)
    parser.add_argument("--compact", action="store_true")
    parser.add_argument(
        "--provider-id",
        action="append",
        default=[],
        help=(
            "scan an existing provider from accFull.csv using the normal individual "
            "onboarding flow; repeat to scan an explicit list"
        ),
    )
    args = parser.parse_args()

    try:
        if args.provider_id:
            result = onboard_provider_accounts(
                api=args.api,
                provider_ids=args.provider_id,
                accounts_path=Path(args.accounts_file) if args.accounts_file else None,
                timeout_seconds=max(15, min(args.timeout_seconds, 180)),
            )
        else:
            login = os.environ.get(USER_ENV, "").strip()
            password = os.environ.get(PASSWORD_ENV, "")
            if not login or not password:
                print(
                    json.dumps(
                        {
                            "ok": False,
                            "error": (
                                f"{USER_ENV} and {PASSWORD_ENV} are required unless "
                                "--provider-id is supplied"
                            ),
                        }
                    )
                )
                return 2
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
