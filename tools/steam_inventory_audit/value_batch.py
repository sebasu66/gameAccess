from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from audit import HttpClient, PriceCache, SteamInventoryAuditor


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def load_transfer_batch(path: Path) -> dict[str, Any]:
    decoded = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(decoded, dict) or not isinstance(decoded.get("results"), list):
        raise ValueError("Expected inventory-transfer-batch JSON with a results array")
    return decoded


def collect_items(batch: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for result in batch.get("results") or []:
        if not isinstance(result, dict) or result.get("status") != "ok":
            continue
        provider_id = str(result.get("provider_id") or "").strip()
        label = str(result.get("label") or provider_id).strip()
        steam_id64 = str(result.get("steam_id64") or "").strip()
        for item in result.get("items") or []:
            if not isinstance(item, dict):
                continue
            market_hash_name = str(item.get("market_hash_name") or item.get("name") or "").strip()
            if not market_hash_name:
                continue
            try:
                app_id = int(item.get("appid") or 0)
                context_id = int(item.get("contextid") or 0)
                amount = max(1, int(item.get("amount") or 1))
            except (TypeError, ValueError):
                continue
            if app_id <= 0:
                continue
            rows.append(
                {
                    "provider_id": provider_id,
                    "label": label,
                    "steam_id64": steam_id64,
                    "app_id": app_id,
                    "context_id": context_id,
                    "asset_id": str(item.get("assetid") or ""),
                    "amount": amount,
                    "name": str(item.get("name") or market_hash_name),
                    "market_hash_name": market_hash_name,
                    "type": str(item.get("type") or ""),
                }
            )
    return rows


def value_items(
    rows: list[dict[str, Any]],
    *,
    auditor: SteamInventoryAuditor,
    price_cache: PriceCache,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    keys = list(dict.fromkeys((int(row["app_id"]), str(row["market_hash_name"])) for row in rows))
    prices: dict[tuple[int, str], dict[str, Any]] = {}
    for index, (app_id, market_hash_name) in enumerate(keys, start=1):
        print(f"[{index}/{len(keys)}] {app_id} {market_hash_name}", flush=True)
        prices[(app_id, market_hash_name)] = auditor.price(app_id, market_hash_name)
        price_cache.save()

    valued_rows: list[dict[str, Any]] = []
    account_totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    account_meta: dict[str, dict[str, Any]] = {}
    for row in rows:
        price = prices[(int(row["app_id"]), str(row["market_hash_name"]))]
        numeric = _decimal(price.get("price_numeric"))
        estimated_value = numeric * int(row["amount"]) if numeric is not None else None
        provider_id = str(row["provider_id"])
        if estimated_value is not None:
            account_totals[provider_id] += estimated_value
        account_meta.setdefault(
            provider_id,
            {
                "provider_id": provider_id,
                "label": row.get("label"),
                "steam_id64": row.get("steam_id64"),
                "item_count": 0,
                "priced_item_count": 0,
            },
        )
        account_meta[provider_id]["item_count"] += int(row["amount"])
        if estimated_value is not None:
            account_meta[provider_id]["priced_item_count"] += int(row["amount"])
        valued_rows.append(
            {
                **row,
                "price": price,
                "estimated_value": str(estimated_value) if estimated_value is not None else None,
            }
        )

    accounts: dict[str, dict[str, Any]] = {}
    for provider_id, meta in account_meta.items():
        accounts[provider_id] = {
            **meta,
            "estimated_total": str(account_totals[provider_id]),
        }

    valued_rows.sort(
        key=lambda row: (
            -(_decimal(row.get("estimated_value")) or Decimal("0")),
            str(row.get("provider_id") or ""),
            str(row.get("market_hash_name") or "").casefold(),
        )
    )
    return valued_rows, accounts


def write_items_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "provider_id",
        "label",
        "steam_id64",
        "app_id",
        "context_id",
        "asset_id",
        "amount",
        "name",
        "market_hash_name",
        "type",
        "price_status",
        "lowest_price",
        "median_price",
        "price_numeric",
        "estimated_value",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            price = row.get("price") or {}
            writer.writerow(
                {
                    "provider_id": row.get("provider_id"),
                    "label": row.get("label"),
                    "steam_id64": row.get("steam_id64"),
                    "app_id": row.get("app_id"),
                    "context_id": row.get("context_id"),
                    "asset_id": row.get("asset_id"),
                    "amount": row.get("amount"),
                    "name": row.get("name"),
                    "market_hash_name": row.get("market_hash_name"),
                    "type": row.get("type"),
                    "price_status": price.get("status"),
                    "lowest_price": price.get("lowest_price"),
                    "median_price": price.get("median_price"),
                    "price_numeric": price.get("price_numeric"),
                    "estimated_value": row.get("estimated_value"),
                }
            )


def write_accounts_csv(path: Path, accounts: list[dict[str, Any]]) -> None:
    fields = ["provider_id", "label", "steam_id64", "item_count", "priced_item_count", "estimated_total"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows({field: row.get(field) for field in fields} for row in accounts)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Value an existing inventory-transfer-batch.json without rescanning Steam inventories"
    )
    parser.add_argument("batch", type=Path)
    parser.add_argument("--out-dir", type=Path, default=Path("debug/inventory-valuation"))
    parser.add_argument("--currency", type=int, default=1, help="Steam Market currency code; 1 = USD")
    parser.add_argument("--price-delay", type=float, default=1.2, help="Seconds between uncached Market requests")
    parser.add_argument("--price-cache-hours", type=float, default=24.0)
    args = parser.parse_args()

    batch = load_transfer_batch(args.batch)
    rows = collect_items(batch)
    if not rows:
        raise SystemExit("No transferable items found in the batch file")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    price_cache = PriceCache(args.out_dir / "price_cache.json", max_age_hours=args.price_cache_hours)
    auditor = SteamInventoryAuditor(
        http=HttpClient(),
        price_cache=price_cache,
        currency=args.currency,
        price_delay_seconds=args.price_delay,
        fetch_prices=True,
    )
    valued_rows, account_map = value_items(rows, auditor=auditor, price_cache=price_cache)
    accounts = sorted(
        account_map.values(),
        key=lambda row: (-(_decimal(row.get("estimated_total")) or Decimal("0")), str(row["provider_id"])),
    )
    total = sum((_decimal(row.get("estimated_value")) or Decimal("0")) for row in valued_rows)
    statuses = Counter(str((row.get("price") or {}).get("status") or "unknown") for row in valued_rows)
    unique_market_items = len({(row["app_id"], row["market_hash_name"]) for row in valued_rows})

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_batch": str(args.batch),
        "source_generated_at": batch.get("generated_at"),
        "currency_code": args.currency,
        "read_only": True,
        "rescanned_inventories": False,
        "account_count": len(accounts),
        "item_count": sum(int(row["amount"]) for row in valued_rows),
        "unique_market_item_count": unique_market_items,
        "estimated_total": str(total),
        "price_status_counts": dict(sorted(statuses.items())),
        "accounts": accounts,
        "items": valued_rows,
    }

    json_path = args.out_dir / "valuation_report.json"
    items_csv_path = args.out_dir / "valuation_items.csv"
    accounts_csv_path = args.out_dir / "valuation_accounts.csv"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_items_csv(items_csv_path, valued_rows)
    write_accounts_csv(accounts_csv_path, accounts)
    price_cache.save()

    print(
        json.dumps(
            {
                "ok": True,
                "accounts": len(accounts),
                "items": report["item_count"],
                "unique_market_items": unique_market_items,
                "estimated_total": str(total),
                "json": str(json_path),
                "items_csv": str(items_csv_path),
                "accounts_csv": str(accounts_csv_path),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
