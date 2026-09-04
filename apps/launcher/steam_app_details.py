"""Inspect non-sensitive local Steam app metadata for install/import workflows."""
from __future__ import annotations

import argparse
import json

from steam_appinfo import read_local_app_catalog
from steam_pool import steam_root


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect cached Steam app install metadata")
    parser.add_argument("app_id", type=int)
    args = parser.parse_args()

    root = steam_root()
    if root is None:
        print(json.dumps({"ok": False, "error": "steam_root_not_found"}, ensure_ascii=True))
        return 2
    path = root / "appcache" / "appinfo.vdf"
    catalog = read_local_app_catalog(path, {args.app_id})
    item = catalog.get(args.app_id)
    if item is None:
        print(json.dumps({"ok": False, "error": "app_not_in_local_appinfo", "app_id": args.app_id}, ensure_ascii=True))
        return 3
    print(json.dumps({"ok": True, **item}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
