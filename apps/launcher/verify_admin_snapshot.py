"""Verify the admin console reflects the authoritative Steam license inventory."""
from __future__ import annotations

import argparse
import json
import webbrowser

import requests


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:38147")
    parser.add_argument("--app-id", type=int, required=True)
    parser.add_argument("--copies", type=int, required=True)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()

    base = args.api.rstrip("/")
    response = requests.get(f"{base}/admin-console/overview", timeout=15)
    response.raise_for_status()
    overview = response.json()
    game = next((row for row in overview.get("licenses", []) if int(row.get("app_id") or 0) == args.app_id), None)
    actual = int(game.get("copies_total") or 0) if game else 0
    ok = actual == args.copies
    result = {
        "ok": ok,
        "stats": overview.get("stats", {}),
        "app": game,
        "expected_copies": args.copies,
        "actual_copies": actual,
        "diagnostics": overview.get("diagnostics", []),
    }
    print(json.dumps(result, ensure_ascii=False))
    if args.open:
        webbrowser.open(f"{base}/admin-console/")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
