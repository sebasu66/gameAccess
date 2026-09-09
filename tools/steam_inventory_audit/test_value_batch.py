from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import audit
import value_batch


class FakeAuditor:
    def __init__(self) -> None:
        self.calls: list[tuple[int, str]] = []

    def price(self, app_id: int, market_hash_name: str):
        self.calls.append((app_id, market_hash_name))
        values = {
            (730, "Case A"): "2.50",
            (570, "Dota Item"): "5.00",
        }
        numeric = values.get((app_id, market_hash_name))
        if numeric is None:
            return {"status": "unpriced"}
        return {
            "status": "ok",
            "lowest_price": f"${numeric}",
            "price_numeric": numeric,
        }


class BatchValuationTests(unittest.TestCase):
    def test_collects_only_successful_transferable_rows(self):
        batch = {
            "results": [
                {
                    "status": "ok",
                    "provider_id": "provider-001",
                    "label": "one",
                    "steam_id64": 76561198000000001,
                    "items": [
                        {
                            "appid": 730,
                            "contextid": 2,
                            "assetid": 10,
                            "amount": 1,
                            "name": "Case A",
                            "market_hash_name": "Case A",
                            "type": "Container",
                        }
                    ],
                },
                {
                    "status": "scan_failed",
                    "provider_id": "provider-002",
                    "items": [{"appid": 730, "market_hash_name": "Should Skip"}],
                },
            ]
        }
        rows = value_batch.collect_items(batch)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["provider_id"], "provider-001")
        self.assertEqual(rows[0]["market_hash_name"], "Case A")

    def test_prices_each_unique_market_item_once_and_ranks_accounts(self):
        rows = [
            {
                "provider_id": "provider-001",
                "label": "one",
                "steam_id64": "76561198000000001",
                "app_id": 730,
                "context_id": 2,
                "asset_id": "1",
                "amount": 1,
                "name": "Case A",
                "market_hash_name": "Case A",
                "type": "Container",
            },
            {
                "provider_id": "provider-001",
                "label": "one",
                "steam_id64": "76561198000000001",
                "app_id": 730,
                "context_id": 2,
                "asset_id": "2",
                "amount": 1,
                "name": "Case A",
                "market_hash_name": "Case A",
                "type": "Container",
            },
            {
                "provider_id": "provider-002",
                "label": "two",
                "steam_id64": "76561198000000002",
                "app_id": 570,
                "context_id": 2,
                "asset_id": "3",
                "amount": 1,
                "name": "Dota Item",
                "market_hash_name": "Dota Item",
                "type": "Wearable",
            },
        ]
        fake = FakeAuditor()
        with tempfile.TemporaryDirectory() as tmp:
            cache = audit.PriceCache(Path(tmp) / "prices.json")
            valued, accounts = value_batch.value_items(rows, auditor=fake, price_cache=cache)

        self.assertEqual(fake.calls, [(730, "Case A"), (570, "Dota Item")])
        self.assertEqual(accounts["provider-001"]["estimated_total"], "5.00")
        self.assertEqual(accounts["provider-002"]["estimated_total"], "5.00")
        self.assertEqual(sum(1 for row in valued if row["market_hash_name"] == "Case A"), 2)


if __name__ == "__main__":
    unittest.main()
