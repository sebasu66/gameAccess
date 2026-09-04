"""Full GameAccess provider refresh: SteamKit licenses + family graph + backend sync."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from typing import Any

import requests

from pool_sync import build_game_pool, compact_pool, sync_backend
from provider_license_scan import compact_inventory, persist_scan_result, scan_provider_licenses
from provider_roster import load_provider_credentials


def build_family_graph(inventory: dict[str, Any]) -> list[dict[str, Any]]:
    credentials = load_provider_credentials()
    label_by_provider = {row.provider_id: row.label for row in credentials}
    account_by_provider = {
        str(row.get("provider_id")): row
        for row in inventory.get("accounts") or []
        if isinstance(row, dict)
    }

    discovered_members: dict[str, set[str]] = defaultdict(set)
    family_by_provider: dict[str, str] = {}
    for provider_id, row in account_by_provider.items():
        family_key = str(row.get("family_key") or "").strip()
        if not family_key:
            continue
        family_by_provider[provider_id] = family_key
        discovered_members[family_key].add(provider_id)
        discovered_members[family_key].update(
            str(member) for member in row.get("family_member_provider_ids") or []
            if str(member) in label_by_provider
        )

    # If one family member failed its own scan but another family member identified
    # it, assign it to the discovered family. Its missing/disabled ownership does not
    # create capacity until a later successful scan.
    for family_key, members in list(discovered_members.items()):
        for provider_id in members:
            family_by_provider.setdefault(provider_id, family_key)

    licenses_by_family: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
    for provider_id, row in account_by_provider.items():
        family_key = family_by_provider.get(provider_id)
        if not family_key or str(row.get("scan_status") or "") != "ok":
            continue
        owner_label = label_by_provider.get(provider_id)
        if not owner_label:
            continue
        for raw_app_id in set(row.get("owned_app_ids") or []):
            try:
                app_id = int(raw_app_id)
            except (TypeError, ValueError):
                continue
            if app_id > 0:
                licenses_by_family[family_key][app_id].append(owner_label)

    result: list[dict[str, Any]] = []
    for family_key in sorted(discovered_members):
        members = sorted(
            label_by_provider[provider_id]
            for provider_id in discovered_members[family_key]
            if provider_id in label_by_provider
        )
        licenses = [
            {"app_id": app_id, "quantity": len(owner_labels), "owner_labels": sorted(owner_labels)}
            for app_id, owner_labels in sorted(licenses_by_family.get(family_key, {}).items())
        ]
        result.append({"family_key": family_key, "members": members, "licenses": licenses})
    return result


def refresh(*, api: str, timeout_seconds: int = 70) -> dict[str, Any]:
    inventory = scan_provider_licenses(provider_ids=None, timeout_seconds=timeout_seconds)
    persistence = persist_scan_result(inventory)

    # Per-account sync still updates every successful provider and disables failed
    # scans without erasing their prior ownership rows.
    pool = build_game_pool(refresh_licenses=False)
    backend = sync_backend(pool, api)

    families = build_family_graph(inventory)
    family_response = requests.post(
        f"{api.rstrip('/')}/admin/pool/families/sync",
        json={"families": families},
        timeout=60,
    )
    family_response.raise_for_status()

    return {
        "ok": bool(inventory.get("successful_scan_count")),
        "inventory": compact_inventory(inventory),
        "persistence": persistence,
        "pool": compact_pool(pool),
        "backend": backend,
        "families": {
            "discovered": len(families),
            "members": sum(len(family.get("members") or []) for family in families),
            "license_copies": sum(
                int(license_row.get("quantity") or 0)
                for family in families
                for license_row in family.get("licenses") or []
            ),
            "sync": family_response.json(),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh GameAccess Steam provider family/license graph")
    parser.add_argument("--api", default="http://127.0.0.1:38147")
    parser.add_argument("--timeout-seconds", type=int, default=70)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()
    result = refresh(api=args.api, timeout_seconds=args.timeout_seconds)
    if args.compact:
        result["families"].pop("sync", None)
    print(json.dumps(result, ensure_ascii=False))
    inventory = result.get("inventory") or {}
    if inventory.get("complete"):
        return 0
    return 2 if inventory.get("successful_scan_count") else 3


if __name__ == "__main__":
    raise SystemExit(main())
