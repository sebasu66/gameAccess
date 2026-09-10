from __future__ import annotations

import csv
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

PRICE_URL = "https://steamcommunity.com/market/priceoverview/"
USER_AGENT = "GameAccess-Inventory-Valuation/1.0"
CURRENCY = 1  # USD
BASE_DELAY_SECONDS = 3.0
RATE_LIMIT_DELAYS = (30, 60, 120)


def parse_usd(value: object) -> Decimal | None:
    if not value:
        return None
    match = re.search(r"[0-9][0-9,]*(?:\.[0-9]+)?", str(value))
    if not match:
        return None
    try:
        return Decimal(match.group(0).replace(",", ""))
    except InvalidOperation:
        return None


def load_items() -> list[dict[str, object]]:
    aggregated: dict[tuple[int, str], int] = {}
    for path in sorted(Path("tools/steam_inventory_audit").glob("pricing-input-*.tsv")):
        for raw in path.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            appid_text, quantity_text, market_hash_name = raw.split("\t", 2)
            key = (int(appid_text), market_hash_name)
            aggregated[key] = aggregated.get(key, 0) + int(quantity_text)
    return [
        {"appid": appid, "quantity": quantity, "market_hash_name": name}
        for (appid, name), quantity in aggregated.items()
    ]


def query_price(appid: int, market_hash_name: str) -> tuple[dict[str, object], bool]:
    params = urllib.parse.urlencode(
        {"appid": appid, "currency": CURRENCY, "market_hash_name": market_hash_name}
    )
    request = urllib.request.Request(
        PRICE_URL + "?" + params,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*"},
    )

    for attempt in range(len(RATE_LIMIT_DELAYS) + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8", errors="replace")
            data = json.loads(body)
            if not isinstance(data, dict):
                return {"status": "error", "error": "Steam returned non-object JSON"}, False
            if not data.get("success"):
                return {"status": "unpriced", "response": data}, False
            lowest = data.get("lowest_price")
            median = data.get("median_price")
            numeric = parse_usd(lowest) or parse_usd(median)
            if numeric is None:
                return {
                    "status": "unpriced",
                    "lowest_price": lowest,
                    "median_price": median,
                    "volume": data.get("volume"),
                }, False
            return {
                "status": "ok",
                "lowest_price": lowest,
                "median_price": median,
                "volume": data.get("volume"),
                "price_numeric": str(numeric),
            }, False
        except urllib.error.HTTPError as exc:
            if exc.code != 429:
                return {"status": f"http_{exc.code}", "error": str(exc)}, False
            if attempt >= len(RATE_LIMIT_DELAYS):
                return {"status": "error_429", "error": "Steam rate limit persisted after retries"}, True
            retry_after = exc.headers.get("Retry-After")
            delay = RATE_LIMIT_DELAYS[attempt]
            if retry_after:
                try:
                    delay = max(delay, int(float(retry_after)))
                except ValueError:
                    pass
            time.sleep(delay)
        except Exception as exc:  # keep partial artifact instead of losing the run
            return {"status": "error", "error": f"{type(exc).__name__}: {exc}"}, False
    raise AssertionError("unreachable")


def main() -> int:
    items = load_items()
    out = Path("artifacts/inventory-pricing")
    out.mkdir(parents=True, exist_ok=True)
    txt_path = out / "inventory-prices.txt"
    csv_path = out / "inventory-prices.csv"
    json_path = out / "inventory-prices.json"
    ranked_path = out / "inventory-prices-ranked.txt"

    total_units = sum(int(row["quantity"]) for row in items)
    results: list[dict[str, object]] = []
    estimated_total = Decimal("0")
    priced_units = 0
    aborted_rate_limit = False

    with txt_path.open("w", encoding="utf-8", newline="\n") as text, csv_path.open(
        "w", encoding="utf-8", newline=""
    ) as csv_handle:
        text.write("Steam Community Market valuation (USD)\n")
        text.write(f"Started: {datetime.now(timezone.utc).isoformat()}\n")
        text.write(f"Unique market items: {len(items)}\n")
        text.write(f"Total units: {total_units}\n\n")
        text.write("INDEX\tAPPID\tQTY\tSTATUS\tPRICE_USD\tESTIMATED_USD\tLOWEST\tMEDIAN\tITEM\tERROR\n")
        text.flush()

        writer = csv.DictWriter(
            csv_handle,
            fieldnames=[
                "index",
                "appid",
                "quantity",
                "status",
                "price_usd",
                "estimated_usd",
                "lowest_price",
                "median_price",
                "volume",
                "market_hash_name",
                "error",
            ],
        )
        writer.writeheader()
        csv_handle.flush()

        for index, item in enumerate(items, start=1):
            appid = int(item["appid"])
            quantity = int(item["quantity"])
            name = str(item["market_hash_name"])
            price, hard_429 = query_price(appid, name)
            numeric = parse_usd(price.get("price_numeric"))
            estimated = numeric * quantity if numeric is not None else None
            if estimated is not None:
                estimated_total += estimated
                priced_units += quantity

            row = {
                "index": index,
                "appid": appid,
                "quantity": quantity,
                "status": price.get("status"),
                "price_usd": str(numeric) if numeric is not None else "",
                "estimated_usd": str(estimated) if estimated is not None else "",
                "lowest_price": price.get("lowest_price") or "",
                "median_price": price.get("median_price") or "",
                "volume": price.get("volume") or "",
                "market_hash_name": name,
                "error": price.get("error") or "",
            }
            results.append(row)
            writer.writerow(row)
            csv_handle.flush()
            text.write(
                "\t".join(
                    str(row[key]).replace("\t", " ").replace("\n", " ")
                    for key in (
                        "index",
                        "appid",
                        "quantity",
                        "status",
                        "price_usd",
                        "estimated_usd",
                        "lowest_price",
                        "median_price",
                        "market_hash_name",
                        "error",
                    )
                )
                + "\n"
            )
            text.flush()

            if hard_429:
                aborted_rate_limit = True
                break
            if index < len(items):
                time.sleep(BASE_DELAY_SECONDS)

        text.write("\nSUMMARY\n")
        text.write(f"Processed unique items: {len(results)}/{len(items)}\n")
        text.write(f"Priced units: {priced_units}/{total_units}\n")
        text.write(f"Estimated total USD (priced items only): {estimated_total}\n")
        text.write(f"Complete: {not aborted_rate_limit and len(results) == len(items)}\n")
        text.write(f"Aborted due persistent HTTP 429: {aborted_rate_limit}\n")

    ranked = sorted(
        results,
        key=lambda row: Decimal(str(row["estimated_usd"])) if row["estimated_usd"] else Decimal("0"),
        reverse=True,
    )
    with ranked_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("RANK\tESTIMATED_USD\tPRICE_USD\tQTY\tAPPID\tITEM\n")
        for rank, row in enumerate(ranked, start=1):
            handle.write(
                f"{rank}\t{row['estimated_usd']}\t{row['price_usd']}\t{row['quantity']}\t"
                f"{row['appid']}\t{row['market_hash_name']}\n"
            )

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "currency": "USD",
        "unique_market_items": len(items),
        "total_units": total_units,
        "processed_unique_items": len(results),
        "priced_units": priced_units,
        "estimated_total_usd_priced_items": str(estimated_total),
        "complete": not aborted_rate_limit and len(results) == len(items),
        "aborted_due_rate_limit": aborted_rate_limit,
        "items": results,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return 2 if aborted_rate_limit else 0


if __name__ == "__main__":
    raise SystemExit(main())
