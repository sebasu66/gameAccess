import unittest
from unittest.mock import patch

from steam_web_inventory import build_web_inventory


class FakeResponse:
    def __init__(self, games): self.games = games
    def raise_for_status(self): pass
    def json(self): return {"response": {"games": self.games}}


class FakeSession:
    def get(self, _url, *, params, timeout):
        games = {"1": [{"appid": 10, "name": "A"}], "2": [{"appid": 10, "name": "A"}, {"appid": 20, "name": "B"}]}
        return FakeResponse(games[params["steamid"]])


class WebInventoryTests(unittest.TestCase):
    @patch("steam_web_inventory.remembered_account_identities")
    def test_preserves_multiple_owners_for_same_app(self, identities):
        identities.return_value = [
            {"steam_id64": "1", "account_name": "one", "display_name": "One", "user_id32": 1},
            {"steam_id64": "2", "account_name": "two", "display_name": "Two", "user_id32": 2},
        ]
        result = build_web_inventory("secret", session=FakeSession())
        self.assertTrue(result["complete"])
        self.assertEqual(result["owners"]["10"], ["1", "2"])
        self.assertEqual(result["owners"]["20"], ["2"])
        self.assertEqual(len(result["games"]), 2)


if __name__ == "__main__":
    unittest.main()
