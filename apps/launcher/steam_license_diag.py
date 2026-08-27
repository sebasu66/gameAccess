"""Diagnose Steam ownership signals for one AppID without reading credentials.

Prints only public/account-local game metadata and package IDs that contain the
requested app. It never reads/emits passwords, login keys, cookies, Steam Guard
secrets, auth blobs, or license values.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from steam_packageinfo import read_package_app_map
from steam_pool import local_library_apps, remembered_account_identities, steam_root


def safe_scalars(value: dict[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for key, item in value.items():
        if isinstance(item, (str, int, float, bool)):
            folded = str(key).casefold()
            if any(term in folded for term in ("token", "key", "secret", "auth", "password", "cookie")):
                continue
            safe[str(key)] = item
        elif isinstance(item, dict):
            safe[f"{key}.__keys__"] = sorted(str(k) for k in item.keys())[:50]
    return safe


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-id", required=True, type=int)
    args = parser.parse_args()

    accounts = []
    for identity in remembered_account_identities():
        user_id = identity.get("user_id32")
        block = local_library_apps(user_id).get(args.app_id, {}) if isinstance(user_id, int) else {}
        accounts.append(
            {
                "display_name": identity.get("display_name"),
                "account_name": identity.get("account_name"),
                "user_id32": user_id,
                "has_app_entry": bool(block),
                "app_metadata": safe_scalars(block) if isinstance(block, dict) else {},
            }
        )

    root = steam_root()
    packages = []
    package_error = None
    packageinfo = root / "appcache" / "packageinfo.vdf" if root else Path("__missing__")
    if packageinfo.is_file():
        try:
            mapping, _ = read_package_app_map(packageinfo)
            packages = sorted(package_id for package_id, app_ids in mapping.items() if args.app_id in app_ids)
        except Exception as exc:
            package_error = str(exc)

    print(
        json.dumps(
            {
                "app_id": args.app_id,
                "accounts": accounts,
                "packages_containing_app": packages,
                "packageinfo_error": package_error,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
