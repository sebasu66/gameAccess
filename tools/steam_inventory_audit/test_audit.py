from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import audit


class FakeHttp:
    def __init__(self) -> None:
        self.calls = []

    def get_json(self, url, params=None):
        self.calls.append((url, params or {}))
        if "priceoverview" in url:
            return {"success": True, "lowest_price": "$2.50", "median_price": "$2.75", "volume": "10"}
        return {
            "success": 1,
            "total_inventory_count": 3,
            "assets": [
                {"classid": "1", "instanceid": "0", "amount": "2"},
                {"classid": "2", "instanceid": "0", "amount": "1"},
            ],
            "descriptions": [
                {
                    "classid": "1",
                    "instanceid": "0",
                    "name": "Market Item",
                    "market_hash_name": "Market Item",
                    "marketable": 1,
                    "tradable": 1,
                },
                {
                    "classid": "2",
                    "instanceid": "0",
                    "name": "Locked Item",
                    "market_hash_name": "Locked Item",
                    "marketable": 0,
                    "tradable": 0,
                },
            ],
            "more_items": False,
        }


class InventoryAuditTests(unittest.TestCase):
    def test_price_parser_handles_us_and_decimal_comma(self):
        self.assertEqual(audit._price_number("$1,234.56 USD"), "1234.56")
        self.assertEqual(audit._price_number("1,23€"), "1.23")

    def test_audit_aggregates_quantity_and_values_only_marketable_items(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = audit.PriceCache(Path(tmp) / "prices.json")
            auditor = audit.SteamInventoryAuditor(
                http=FakeHttp(),
                price_cache=cache,
                price_delay_seconds=0,
            )
            report = auditor.audit_account(
                audit.Account("test", "76561198000000001"),
                [audit.Context(753, 6, "Steam Community")],
            )

        self.assertEqual(report["estimated_total"], "5.00")
        self.assertEqual(report["marketable_quantity"], 2)
        self.assertEqual(report["tradable_quantity"], 2)
        market = next(row for row in report["items"] if row["market_hash_name"] == "Market Item")
        locked = next(row for row in report["items"] if row["market_hash_name"] == "Locked Item")
        self.assertEqual(market["quantity"], 2)
        self.assertEqual(market["estimated_value"], "5.00")
        self.assertEqual(locked["price"]["status"], "not_marketable")
        self.assertIsNone(locked["estimated_value"])

    def test_parse_context(self):
        context = audit.parse_context("252490:2:Rust")
        self.assertEqual((context.app_id, context.context_id, context.label), (252490, 2, "Rust"))


if __name__ == "__main__":
    unittest.main()
