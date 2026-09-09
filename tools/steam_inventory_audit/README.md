# Steam Inventory Batch Audit

Standalone, read-only inventory auditor. It is intentionally isolated from the GameAccess launcher, backend, provider-license scanner and account pool.

It does **not** log in to Steam, submit trades, list items for sale, read passwords, or modify GameAccess data.

## Input

Create a CSV:

```csv
account_name,steam_id64
account_one,76561198000000001
account_two,76561198000000002
```

JSON is also accepted:

```json
{
  "accounts": [
    {"account_name": "account_one", "steam_id64": "76561198000000001"}
  ]
}
```

Only SteamID64 is required for network access. `account_name` is a local label for the report.

## Default inventories

The default scan checks these public inventory contexts:

- Steam Community items: `753:6` (cards, backgrounds, emoticons, gems/boosters when exposed there)
- Counter-Strike 2: `730:2`
- Team Fortress 2: `440:2`
- Dota 2: `570:2`

Additional contexts can be supplied repeatedly:

```powershell
python audit.py accounts.csv --context 252490:2:Rust
```

Use `--no-default-contexts` when you want only explicitly supplied contexts.

## Run

From this directory:

```powershell
python audit.py accounts.csv
```

Inventory-only scan without Market price calls:

```powershell
python audit.py accounts.csv --no-prices
```

The output directory defaults to `inventory-audit-output/` and contains:

- `inventory_report.json` — complete per-account report and context errors
- `inventory_items.csv` — flat table suitable for Excel/analysis
- `price_cache.json` — cached Market responses, 24 hours by default

The script aggregates identical `market_hash_name` items within an account/context, preserves `marketable` and `tradable`, and computes an approximate value using the Steam Community Market's public `priceoverview` response. The numeric value prefers `lowest_price`, then `median_price`.

## Important valuation semantics

`estimated_total` is an **approximate Steam Community Market / Steam Wallet value**, not guaranteed cash proceeds. Fees, liquidity, trade restrictions, listing restrictions, account restrictions, currency conversion and price movement are not modeled.

A marketable item is not necessarily currently tradable, and a tradable item is not necessarily marketable. Both flags are reported independently.

## Privacy and failures

This scanner works only with inventory data that Steam exposes publicly for the requested SteamID/context. Private or unavailable contexts are recorded as errors for that account without aborting the rest of the batch.

No Steam Web API key is required.

## Rate limiting

Market valuation is deliberately serialized. By default the tool waits `1.2` seconds between uncached price requests and caches results for 24 hours.

Adjust carefully:

```powershell
python audit.py accounts.csv --price-delay 2 --price-cache-hours 48
```

The inventory fetch itself handles pagination and retries transient `429/5xx` responses with backoff.

## Scope

This tool is intentionally **audit-only**. Any future trade-transfer or sale automation should be a separate tool with a separate explicit authorization boundary; it should not be added to this scanner.
