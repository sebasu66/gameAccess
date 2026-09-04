"""Apply the latest saved SteamKit family/license scan without authenticating Steam again."""
from __future__ import annotations

import argparse
import json
from typing import Any

import requests

from family_refresh import build_family_graph
from pool_sync import build_game_pool, compact_pool, sync_backend
from provider_license_scan import (
    DEFAULT_DIAGNOSTIC_OUTPUT,
    DEFAULT_OUTPUT,
    compact_inventory,
    load_provider_license_inventory,
)


def load_latest_inventory() -> dict[str, Any]:
    diagnostic = load_provider_license_inventory(DEFAULT_DIAGNOSTIC_OUTPUT)
    authoritative = load_provider_license_inventory(DEFAULT_OUTPUT)
    candidates = [item for item in (diagnostic, authoritative) if item]
    if not candidates:
        raise RuntimeError("No saved SteamKit provider inventory is available")
    return max(candidates, key=lambda item: str(item.get("verified_at") or ""))


def sync_saved(*, api: str) -> dict[str, Any]:
    inventory = load_latest_inventory()
    pool = build_game_pool(refresh_licenses=False)
    backend = sync_backend(pool, api)
    families = build_family_graph(inventory)
    response = requests.post(
        f"{api.rstrip('/')}/admin/pool/families/sync",
        json={"families": families},
        timeout=60,
    )
    response.raise_for_status()
    return {
        "ok": True,
        "inventory": compact_inventory(inventory),
        "pool": compact_pool(pool),
        "backend": backend,
        "families": {
            "discovered": len(families),
            "members": sum(len(row.get("members") or []) for row in families),
            "license_copies": sum(
                int(license_row.get("quantity") or 0)
                for family in families
                for license_row in family.get("licenses") or []
            ),
            "sync": response.json(),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Resume GameAccess family sync from saved SteamKit inventory")
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()
    result = sync_saved(api=args.api)
    if args.compact:
        result["families"].pop("sync", None)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
