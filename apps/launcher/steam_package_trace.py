"""Trace where a Steam package ID appears in local metadata without exposing values.

This diagnostic is intentionally privacy-preserving: it reports only filenames,
account labels, and VDF key paths whose key/value exactly equals the requested
numeric package/app id. It never prints arbitrary values from Steam config files.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from steam_pool import _read_vdf, remembered_account_identities, steam_root


def matching_paths(node: Any, needles: set[str], prefix: tuple[str, ...] = ()) -> list[str]:
    hits: list[str] = []
    if not isinstance(node, dict):
        return hits
    for key, value in node.items():
        key_text = str(key)
        path = prefix + (key_text,)
        if key_text in needles:
            hits.append("/".join(path) + " [key]")
        if isinstance(value, dict):
            hits.extend(matching_paths(value, needles, path))
        else:
            value_text = str(value).strip()
            if value_text in needles:
                hits.append("/".join(path) + " [value-match]")
    return hits


def scan_file(path: Path, needles: set[str]) -> list[str]:
    try:
        parsed = _read_vdf(path)
    except Exception:
        return []
    return matching_paths(parsed, needles)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-id", type=int, required=True)
    parser.add_argument("--package-id", type=int, required=True)
    args = parser.parse_args()

    root = steam_root()
    if not root:
        print(json.dumps({"ok": False, "error": "Steam root not found"}))
        return 1

    needles = {str(args.app_id), str(args.package_id)}
    identities = remembered_account_identities()
    accounts = []
    for identity in identities:
        uid = identity.get("user_id32")
        files = []
        if isinstance(uid, int):
            config_dir = root / "userdata" / str(uid) / "config"
            for name in ("localconfig.vdf", "sharedconfig.vdf"):
                path = config_dir / name
                if path.is_file():
                    hits = scan_file(path, needles)
                    if hits:
                        files.append({"file": name, "paths": hits[:100]})
        accounts.append({
            "display_name": identity.get("display_name"),
            "account_name": identity.get("account_name"),
            "user_id32": uid,
            "matches": files,
        })

    global_files = []
    config_dir = root / "config"
    if config_dir.is_dir():
        for name in ("config.vdf", "libraryfolders.vdf"):
            path = config_dir / name
            if path.is_file():
                hits = scan_file(path, needles)
                if hits:
                    global_files.append({"file": name, "paths": hits[:100]})

    print(json.dumps({
        "ok": True,
        "app_id": args.app_id,
        "package_id": args.package_id,
        "accounts": accounts,
        "global_matches": global_files,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
