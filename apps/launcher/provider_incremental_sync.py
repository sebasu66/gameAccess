"""Synchronize successful partial provider scans without rescanning Steam accounts.

This consumes ``provider_licenses.last_scan.json`` produced by the existing
provider license scanner. It imports games for providers whose scan completed,
updates those provider rows in the backend, and rebuilds family routing by
retaining timestamped verified evidence from successive partial scans.

Credentials remain local in ``accFull.csv``. This command never prints account
names or passwords and never performs a Steam login itself.
"""

from __future__ import annotations

import argparse
import json
from typing import Any

from family_refresh import build_family_graph
from provider_account_onboard import _api_json, _import_verified_games
from provider_family_evidence import merge_family_evidence
from provider_license_scan import DEFAULT_DIAGNOSTIC_OUTPUT, load_provider_license_inventory
from provider_ownership_store import DEFAULT_STORE, ProviderOwnershipStore
from provider_roster import load_provider_credentials


def _rows(
    inventory: dict[str, Any] | None, key: str = "accounts"
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in (inventory or {}).get(key, []) or []:
        if not isinstance(row, dict):
            continue
        provider_id = str(row.get("provider_id") or "").strip()
        if provider_id:
            result[provider_id] = row
    return result


def successful_provider_ids(inventory: dict[str, Any]) -> list[str]:
    return sorted(
        str(scan.get("provider_id"))
        for scan in inventory.get("scans", []) or []
        if isinstance(scan, dict)
        and scan.get("provider_id")
        and str(scan.get("status") or "") == "ok"
        and bool(scan.get("complete"))
    )


def sync_recent_scan(
    *,
    api: str = "http://127.0.0.1:38147",
    provider_ids: set[str] | None = None,
) -> dict[str, Any]:
    fresh = load_provider_license_inventory(DEFAULT_DIAGNOSTIC_OUTPUT)
    if not fresh:
        raise RuntimeError("No recent partial provider scan is available")

    ownership_update = ProviderOwnershipStore().record_scan(fresh)
    fresh_accounts = _rows(fresh)
    credentials = {item.provider_id: item for item in load_provider_credentials()}
    successful = successful_provider_ids(fresh)
    if provider_ids is not None:
        successful = [
            provider_id for provider_id in successful if provider_id in provider_ids
        ]

    base = api.rstrip("/")
    _api_json("GET", f"{base}/admin/pool/roster-status", timeout=20.0)

    providers: list[dict[str, Any]] = []
    for provider_id in successful:
        credential = credentials.get(provider_id)
        account = fresh_accounts.get(provider_id)
        if credential is None or account is None:
            continue

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
        game_ids, unresolved_app_ids = _import_verified_games(base, owned_app_ids)
        notes = json.dumps(
            {
                "source": "incremental-provider-refresh",
                "provider_id": provider_id,
                "ownership_source": fresh.get("source") or "steamkit-license-list-pics",
                "ownership_verified_at": fresh.get("verified_at"),
                "inventory_complete": True,
                "owned_app_count": len(owned_app_ids),
                "accessible_app_ids": accessible_app_ids,
                "accessible_app_count": len(accessible_app_ids),
                "imported_game_count": len(game_ids),
                "unresolved_app_count": len(unresolved_app_ids),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        _api_json(
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
        providers.append(
            {
                "provider_id": provider_id,
                "owned_app_count": len(owned_app_ids),
                "accessible_app_count": len(accessible_app_ids),
                "imported_game_count": len(game_ids),
                "unresolved_app_count": len(unresolved_app_ids),
            }
        )

    cumulative = merge_family_evidence(
        {},
        fresh,
        DEFAULT_STORE.with_name("provider_family_evidence.db"),
        selected={row["provider_id"] for row in providers},
    )
    families = build_family_graph(cumulative)
    family_sync = _api_json(
        "POST",
        f"{base}/admin/pool/families/sync",
        payload={"families": families},
        timeout=30.0,
    )
    catalog = _api_json("GET", f"{base}/catalog", timeout=30.0)

    return {
        "ok": True,
        "ownership_promoted": ownership_update["promoted"],
        "synced_provider_count": len(providers),
        "providers": providers,
        "family_count": len(families),
        "family_sync": family_sync,
        "catalog_game_count": len(catalog) if isinstance(catalog, list) else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync successful providers from the latest partial scan"
    )
    parser.add_argument("--api", default="http://127.0.0.1:38147")
    parser.add_argument("--provider-id", action="append", default=[])
    args = parser.parse_args()

    selected = set(args.provider_id) if args.provider_id else None
    result = sync_recent_scan(api=args.api, provider_ids=selected)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

