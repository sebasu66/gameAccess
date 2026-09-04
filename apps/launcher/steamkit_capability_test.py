"""Exercise and summarize the SteamKit capabilities GameAccess relies on.

The test intentionally reports only opaque provider ids and counts. Credentials
remain local in ``cuentas.txt`` and are never written to argv/output.
"""
from __future__ import annotations

import argparse
import json
from typing import Any

from provider_inventory import build_provider_catalog
from provider_license_scan import scan_provider_licenses


def run_capability_test(provider_ids: set[str]) -> dict[str, Any]:
    catalog = build_provider_catalog()
    by_provider = {
        str(account["provider_id"]): account
        for account in catalog.get("accounts", [])
        if isinstance(account, dict)
    }
    licenses = scan_provider_licenses(provider_ids=provider_ids)
    scans = {
        str(scan["provider_id"]): scan
        for scan in licenses.get("scans", [])
        if isinstance(scan, dict)
    }
    ownership = {
        str(account["provider_id"]): set(account.get("owned_app_ids") or [])
        for account in licenses.get("accounts", [])
        if isinstance(account, dict)
    }

    providers: list[dict[str, Any]] = []
    for provider_id in sorted(provider_ids):
        scan = scans.get(provider_id, {})
        account = by_provider.get(provider_id, {})
        accessible = set(account.get("accessible_app_ids") or [])
        owned = ownership.get(provider_id, set())
        providers.append(
            {
                "provider_id": provider_id,
                "authentication_status": scan.get("status", "not_scanned"),
                "guard_detected": scan.get("status") == "guard_required",
                "license_count": int(scan.get("license_count") or 0),
                "pics_resolved_package_count": int(scan.get("package_info_resolved_count") or 0),
                "pics_complete": bool(scan.get("complete")),
                "borrowed_package_count": int(scan.get("borrowed_package_count") or 0),
                "non_permanent_package_count": int(scan.get("non_permanent_package_count") or 0),
                "preferred_owner_package_count": int(scan.get("preferred_owner_package_count") or 0),
                "owned_app_count": len(owned),
                "accessible_app_count": len(accessible),
                "accessible_not_owned_count": len(accessible - owned),
                "owned_not_accessible_count": len(owned - accessible),
            }
        )

    successful = [row for row in providers if row["authentication_status"] == "ok"]
    return {
        "ok": bool(successful),
        "provider_count": len(providers),
        "authentication_ok_count": len(successful),
        "guard_detected_count": sum(1 for row in providers if row["guard_detected"]),
        "borrowed_detected_count": sum(1 for row in providers if row["borrowed_package_count"] > 0),
        "non_permanent_detected_count": sum(1 for row in providers if row["non_permanent_package_count"] > 0),
        "preferred_owner_detected_count": sum(1 for row in providers if row["preferred_owner_package_count"] > 0),
        "pics_complete_count": sum(1 for row in providers if row["pics_complete"]),
        "providers": providers,
        "errors": licenses.get("errors", []),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Exercise GameAccess SteamKit capabilities")
    parser.add_argument("--provider-id", action="append", required=True)
    args = parser.parse_args()
    result = run_capability_test(set(args.provider_id))
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
