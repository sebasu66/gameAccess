# Value an existing authenticated inventory batch

Use this after `transfer_batch.py` has already produced `debug/inventory-transfer-batch.json`.
It does **not** rescan Steam inventories or log into provider accounts. It only reads the saved transferable-item list and queries Steam Community Market `priceoverview` for each unique `(appid, market_hash_name)` pair.

From the repository root:

```powershell
python tools\steam_inventory_audit\value_batch.py debug\inventory-transfer-batch.json
```

Default output directory:

```text
debug/inventory-valuation/
```

Outputs:

- `valuation_report.json` — full priced report and ranked account totals.
- `valuation_items.csv` — items sorted by estimated value.
- `valuation_accounts.csv` — provider accounts sorted by estimated total.
- `price_cache.json` — 24-hour cache so interrupted/repeated runs do not re-query prices already fetched.

Useful options:

```powershell
python tools\steam_inventory_audit\value_batch.py debug\inventory-transfer-batch.json --price-delay 1.5 --currency 1
```

`currency 1` is USD. The default delay is 1.2 seconds between uncached Market requests. HTTP 429/5xx responses use the retry/backoff behavior from `audit.py`.
