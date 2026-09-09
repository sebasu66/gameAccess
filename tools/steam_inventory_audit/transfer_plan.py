from __future__ import annotations

import argparse
import json
from pathlib import Path

from authenticated import inventory_items, scan


def build_plan(account: str) -> dict:
    payload = scan(account, include_items=True)
    if payload.get("status") != "ok":
        return {
            "status": "scan_failed",
            "provider_id": payload.get("provider_id"),
            "label": payload.get("label"),
            "scan": payload,
            "items": [],
        }

    all_items = inventory_items(payload)
    transferable = [
        item
        for item in all_items
        if bool(item.get("tradable"))
        and bool(item.get("marketable"))
        and int(item.get("assetid") or 0) > 0
        and int(item.get("amount") or 0) > 0
    ]
    transferable.sort(
        key=lambda item: (
            int(item.get("appid") or 0),
            int(item.get("contextid") or 0),
            str(item.get("market_hash_name") or item.get("name") or "").casefold(),
            int(item.get("assetid") or 0),
        )
    )

    return {
        "status": "ok",
        "read_only": True,
        "provider_id": payload.get("provider_id"),
        "label": payload.get("label"),
        "steam_id64": payload.get("steam_id64"),
        "scanned_item_count": len(all_items),
        "transferable_item_count": len(transferable),
        "selection_rule": "tradable && marketable",
        "items": [
            {
                "appid": int(item.get("appid") or 0),
                "contextid": int(item.get("contextid") or 0),
                "assetid": int(item.get("assetid") or 0),
                "amount": int(item.get("amount") or 1),
                "name": str(item.get("name") or ""),
                "market_hash_name": str(item.get("market_hash_name") or ""),
                "type": str(item.get("type") or ""),
            }
            for item in transferable
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Plan Steam inventory consolidation without sending a trade")
    parser.add_argument("account", help="provider ID, label, or Steam login")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    plan = build_plan(args.account)
    encoded = json.dumps(plan, ensure_ascii=False, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(encoded, encoding="utf-8")
    print(encoded)
    return 0 if plan.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
