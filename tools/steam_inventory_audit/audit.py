from __future__ import annotations

import argparse
import csv
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

USER_AGENT = "GameAccess-Inventory-Audit/1.0"
INVENTORY_URL = "https://steamcommunity.com/inventory/{steam_id64}/{app_id}/{context_id}"
PRICE_URL = "https://steamcommunity.com/market/priceoverview/"

DEFAULT_CONTEXTS = (
    (753, 6, "Steam Community"),
    (730, 2, "Counter-Strike 2"),
    (440, 2, "Team Fortress 2"),
    (570, 2, "Dota 2"),
)


@dataclass(frozen=True)
class Account:
    account_name: str
    steam_id64: str


@dataclass(frozen=True)
class Context:
    app_id: int
    context_id: int
    label: str


class HttpClient:
    def __init__(self, *, timeout: float = 30.0, retries: int = 3) -> None:
        self.timeout = timeout
        self.retries = retries

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json,text/plain,*/*",
            },
        )
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = response.read().decode("utf-8", errors="replace")
                decoded = json.loads(payload)
                if not isinstance(decoded, dict):
                    raise RuntimeError("Steam returned non-object JSON")
                return decoded
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code not in {429, 500, 502, 503, 504} or attempt >= self.retries:
                    raise
                retry_after = exc.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else 1.5 * (attempt + 1)
                time.sleep(delay)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt >= self.retries:
                    raise
                time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(str(last_error or "HTTP request failed"))


class PriceCache:
    def __init__(self, path: Path, *, max_age_hours: float = 24.0) -> None:
        self.path = path
        self.max_age_seconds = max_age_hours * 3600
        self.rows: dict[str, dict[str, Any]] = {}
        if path.is_file():
            try:
                decoded = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(decoded, dict):
                    self.rows = decoded
            except (OSError, json.JSONDecodeError):
                self.rows = {}

    @staticmethod
    def key(app_id: int, market_hash_name: str, currency: int) -> str:
        return f"{app_id}|{currency}|{market_hash_name}"

    def get(self, app_id: int, market_hash_name: str, currency: int) -> dict[str, Any] | None:
        row = self.rows.get(self.key(app_id, market_hash_name, currency))
        if not isinstance(row, dict):
            return None
        fetched_at = float(row.get("fetched_at") or 0)
        if time.time() - fetched_at > self.max_age_seconds:
            return None
        return row

    def put(self, app_id: int, market_hash_name: str, currency: int, row: dict[str, Any]) -> None:
        self.rows[self.key(app_id, market_hash_name, currency)] = {
            **row,
            "fetched_at": time.time(),
        }

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        temp.write_text(json.dumps(self.rows, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(self.path)


class SteamInventoryAuditor:
    def __init__(
        self,
        *,
        http: HttpClient,
        price_cache: PriceCache,
        currency: int = 1,
        price_delay_seconds: float = 1.2,
        fetch_prices: bool = True,
    ) -> None:
        self.http = http
        self.price_cache = price_cache
        self.currency = currency
        self.price_delay_seconds = max(0.0, price_delay_seconds)
        self.fetch_prices = fetch_prices
        self._last_market_request_at = 0.0

    def fetch_inventory(self, steam_id64: str, context: Context) -> dict[str, Any]:
        assets: list[dict[str, Any]] = []
        descriptions: dict[tuple[str, str], dict[str, Any]] = {}
        start_assetid: str | None = None
        total_inventory_count: int | None = None

        while True:
            params: dict[str, Any] = {"l": "english", "count": 5000}
            if start_assetid:
                params["start_assetid"] = start_assetid
            payload = self.http.get_json(
                INVENTORY_URL.format(
                    steam_id64=steam_id64,
                    app_id=context.app_id,
                    context_id=context.context_id,
                ),
                params,
            )
            if not payload.get("success"):
                raise RuntimeError("Steam inventory endpoint returned success=false")
            total_inventory_count = _as_int(payload.get("total_inventory_count"), total_inventory_count)
            for description in payload.get("descriptions") or []:
                if not isinstance(description, dict):
                    continue
                key = (str(description.get("classid") or ""), str(description.get("instanceid") or "0"))
                descriptions[key] = description
            assets.extend(row for row in payload.get("assets") or [] if isinstance(row, dict))
            if not payload.get("more_items"):
                break
            next_assetid = str(payload.get("last_assetid") or "").strip()
            if not next_assetid or next_assetid == start_assetid:
                raise RuntimeError("Steam inventory pagination stalled")
            start_assetid = next_assetid

        return {
            "assets": assets,
            "descriptions": descriptions,
            "total_inventory_count": total_inventory_count if total_inventory_count is not None else len(assets),
        }

    def price(self, app_id: int, market_hash_name: str) -> dict[str, Any]:
        cached = self.price_cache.get(app_id, market_hash_name, self.currency)
        if cached is not None:
            return {**cached, "source": "cache"}
        if not self.fetch_prices:
            return {"status": "skipped", "source": "disabled"}

        elapsed = time.monotonic() - self._last_market_request_at
        if elapsed < self.price_delay_seconds:
            time.sleep(self.price_delay_seconds - elapsed)
        self._last_market_request_at = time.monotonic()

        try:
            payload = self.http.get_json(
                PRICE_URL,
                {
                    "appid": app_id,
                    "currency": self.currency,
                    "market_hash_name": market_hash_name,
                },
            )
        except Exception as exc:
            row = {"status": "error", "error": str(exc)[:300]}
            self.price_cache.put(app_id, market_hash_name, self.currency, row)
            return {**row, "source": "network"}

        if not payload.get("success"):
            row = {"status": "unpriced"}
        else:
            lowest_raw = payload.get("lowest_price")
            median_raw = payload.get("median_price")
            row = {
                "status": "ok",
                "lowest_price": lowest_raw,
                "median_price": median_raw,
                "volume": payload.get("volume"),
                "price_numeric": _price_number(lowest_raw) or _price_number(median_raw),
            }
        self.price_cache.put(app_id, market_hash_name, self.currency, row)
        return {**row, "source": "network"}

    def audit_account(self, account: Account, contexts: Iterable[Context]) -> dict[str, Any]:
        grouped: dict[tuple[int, int, str], dict[str, Any]] = {}
        context_results: list[dict[str, Any]] = []

        for context in contexts:
            try:
                inventory = self.fetch_inventory(account.steam_id64, context)
            except urllib.error.HTTPError as exc:
                status = "private_or_unavailable" if exc.code in {401, 403} else "http_error"
                context_results.append(
                    {
                        "app_id": context.app_id,
                        "context_id": context.context_id,
                        "label": context.label,
                        "status": status,
                        "http_status": exc.code,
                    }
                )
                continue
            except Exception as exc:
                context_results.append(
                    {
                        "app_id": context.app_id,
                        "context_id": context.context_id,
                        "label": context.label,
                        "status": "error",
                        "error": str(exc)[:300],
                    }
                )
                continue

            descriptions = inventory["descriptions"]
            for asset in inventory["assets"]:
                key = (str(asset.get("classid") or ""), str(asset.get("instanceid") or "0"))
                description = descriptions.get(key, {})
                market_hash_name = str(description.get("market_hash_name") or description.get("name") or "").strip()
                if not market_hash_name:
                    continue
                amount = max(1, _as_int(asset.get("amount"), 1) or 1)
                group_key = (context.app_id, context.context_id, market_hash_name)
                row = grouped.setdefault(
                    group_key,
                    {
                        "app_id": context.app_id,
                        "context_id": context.context_id,
                        "context_label": context.label,
                        "name": str(description.get("name") or market_hash_name),
                        "market_hash_name": market_hash_name,
                        "marketable": bool(_as_int(description.get("marketable"), 0)),
                        "tradable": bool(_as_int(description.get("tradable"), 0)),
                        "quantity": 0,
                    },
                )
                row["quantity"] += amount
                row["marketable"] = row["marketable"] or bool(_as_int(description.get("marketable"), 0))
                row["tradable"] = row["tradable"] or bool(_as_int(description.get("tradable"), 0))

            context_results.append(
                {
                    "app_id": context.app_id,
                    "context_id": context.context_id,
                    "label": context.label,
                    "status": "ok",
                    "asset_count": len(inventory["assets"]),
                    "total_inventory_count": inventory["total_inventory_count"],
                }
            )

        items = list(grouped.values())
        for row in items:
            if row["marketable"]:
                price = self.price(int(row["app_id"]), str(row["market_hash_name"]))
            else:
                price = {"status": "not_marketable", "source": "inventory"}
            row["price"] = price
            numeric = _decimal(price.get("price_numeric"))
            row["estimated_value"] = str(numeric * int(row["quantity"])) if numeric is not None else None

        items.sort(
            key=lambda row: (
                -(_decimal(row.get("estimated_value")) or Decimal("0")),
                str(row["market_hash_name"]).casefold(),
            )
        )
        estimated_total = sum(
            (_decimal(row.get("estimated_value")) or Decimal("0")) for row in items
        )
        marketable_count = sum(int(row["quantity"]) for row in items if row["marketable"])
        tradable_count = sum(int(row["quantity"]) for row in items if row["tradable"])
        return {
            "account_name": account.account_name,
            "steam_id64": account.steam_id64,
            "contexts": context_results,
            "unique_item_count": len(items),
            "marketable_quantity": marketable_count,
            "tradable_quantity": tradable_count,
            "estimated_total": str(estimated_total),
            "items": items,
        }


def load_accounts(path: Path) -> list[Account]:
    if path.suffix.casefold() == ".json":
        decoded = json.loads(path.read_text(encoding="utf-8"))
        rows = decoded.get("accounts", decoded) if isinstance(decoded, dict) else decoded
        if not isinstance(rows, list):
            raise ValueError("JSON accounts file must contain an array or {\"accounts\": [...]} object")
        result = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            account = _account(str(row.get("account_name") or row.get("name") or ""), str(row.get("steam_id64") or ""))
            if account:
                result.append(account)
        return _dedupe_accounts(result)

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        result = []
        for row in reader:
            account = _account(str(row.get("account_name") or row.get("name") or ""), str(row.get("steam_id64") or ""))
            if account:
                result.append(account)
    return _dedupe_accounts(result)


def parse_context(value: str) -> Context:
    parts = value.split(":", 2)
    if len(parts) < 2:
        raise argparse.ArgumentTypeError("context must be APPID:CONTEXTID[:LABEL]")
    try:
        app_id = int(parts[0])
        context_id = int(parts[1])
    except ValueError as exc:
        raise argparse.ArgumentTypeError("APPID and CONTEXTID must be integers") from exc
    label = parts[2] if len(parts) == 3 and parts[2].strip() else f"{app_id}:{context_id}"
    return Context(app_id, context_id, label)


def write_csv(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "account_name",
        "steam_id64",
        "app_id",
        "context_id",
        "context_label",
        "name",
        "market_hash_name",
        "quantity",
        "marketable",
        "tradable",
        "price_status",
        "lowest_price",
        "median_price",
        "price_numeric",
        "estimated_value",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for account in report["accounts"]:
            for item in account["items"]:
                price = item.get("price") or {}
                writer.writerow(
                    {
                        "account_name": account["account_name"],
                        "steam_id64": account["steam_id64"],
                        "app_id": item["app_id"],
                        "context_id": item["context_id"],
                        "context_label": item["context_label"],
                        "name": item["name"],
                        "market_hash_name": item["market_hash_name"],
                        "quantity": item["quantity"],
                        "marketable": item["marketable"],
                        "tradable": item["tradable"],
                        "price_status": price.get("status"),
                        "lowest_price": price.get("lowest_price"),
                        "median_price": price.get("median_price"),
                        "price_numeric": price.get("price_numeric"),
                        "estimated_value": item.get("estimated_value"),
                    }
                )


def _account(account_name: str, steam_id64: str) -> Account | None:
    account_name = account_name.strip()
    steam_id64 = steam_id64.strip()
    if not account_name and not steam_id64:
        return None
    if not re.fullmatch(r"\d{17}", steam_id64):
        raise ValueError(f"Invalid SteamID64 for {account_name or '<unnamed>'}: {steam_id64!r}")
    return Account(account_name or steam_id64, steam_id64)


def _dedupe_accounts(accounts: Iterable[Account]) -> list[Account]:
    result: list[Account] = []
    seen: set[str] = set()
    for account in accounts:
        if account.steam_id64 in seen:
            continue
        seen.add(account.steam_id64)
        result.append(account)
    return result


def _as_int(value: Any, default: int | None = 0) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _price_number(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    cleaned = re.sub(r"[^0-9,.-]", "", value)
    if not cleaned:
        return None
    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(".") > cleaned.rfind(","):
            cleaned = cleaned.replace(",", "")
        else:
            cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        tail = cleaned.rsplit(",", 1)[1]
        cleaned = cleaned.replace(",", ".") if len(tail) == 2 else cleaned.replace(",", "")
    try:
        return str(Decimal(cleaned))
    except InvalidOperation:
        return None


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only batch auditor for public Steam inventories")
    parser.add_argument("accounts", type=Path, help="CSV/JSON containing account_name and steam_id64")
    parser.add_argument("--out-dir", type=Path, default=Path("inventory-audit-output"))
    parser.add_argument("--context", action="append", type=parse_context, default=[], help="APPID:CONTEXTID[:LABEL]; repeatable")
    parser.add_argument("--no-default-contexts", action="store_true")
    parser.add_argument("--no-prices", action="store_true", help="Fetch inventories only")
    parser.add_argument("--currency", type=int, default=1, help="Steam Market currency code; 1 = USD")
    parser.add_argument("--price-delay", type=float, default=1.2, help="Seconds between uncached Market requests")
    parser.add_argument("--price-cache-hours", type=float, default=24.0)
    args = parser.parse_args()

    accounts = load_accounts(args.accounts)
    if not accounts:
        raise SystemExit("No valid accounts found")
    contexts: list[Context] = []
    if not args.no_default_contexts:
        contexts.extend(Context(*row) for row in DEFAULT_CONTEXTS)
    contexts.extend(args.context)
    if not contexts:
        raise SystemExit("No inventory contexts configured")
    contexts = list(dict.fromkeys(contexts))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    price_cache = PriceCache(args.out_dir / "price_cache.json", max_age_hours=args.price_cache_hours)
    auditor = SteamInventoryAuditor(
        http=HttpClient(),
        price_cache=price_cache,
        currency=args.currency,
        price_delay_seconds=args.price_delay,
        fetch_prices=not args.no_prices,
    )

    rows = []
    for index, account in enumerate(accounts, start=1):
        print(f"[{index}/{len(accounts)}] {account.account_name}", flush=True)
        rows.append(auditor.audit_account(account, contexts))
        price_cache.save()

    total = sum((_decimal(row["estimated_total"]) or Decimal("0")) for row in rows)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "read_only": True,
        "currency_code": args.currency,
        "account_count": len(rows),
        "estimated_total": str(total),
        "accounts": rows,
    }
    json_path = args.out_dir / "inventory_report.json"
    csv_path = args.out_dir / "inventory_items.csv"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(csv_path, report)
    price_cache.save()
    print(json.dumps({"ok": True, "accounts": len(rows), "estimated_total": str(total), "json": str(json_path), "csv": str(csv_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
