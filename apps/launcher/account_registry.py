"""The user's accounts on game stores, whose libraries Game Access shows whole (an *account library*).

A library is either Game Access's own (games downloaded from download sources, imported or linked from a folder,
managed one by one) or an account's: everything that account owns, as the store says, synced as a whole. An account
library has no game-by-game membership: a game is in it while the account owns it, and the library leaves only when
the account is removed.

Each account was added by the user signing in on the store's own page (Steam: "Sign in through Steam", through the
GameAccess server, apps/api/app/steam_link_routes.py): only the store's account id and public name are kept, here on
this PC. No Game Access user is needed, so the list is per PC. Store types: "steam" today; Epic, GOG and Xbox later."""
from __future__ import annotations

import json
import time
from pathlib import Path

from atomic_json import write_json
from launcher_data import data_dir

STORES = ("steam",)


class AccountRegistry:
    def __init__(self, launcher: Path | str | None = None):
        self.path = data_dir(launcher) / "accounts.json"

    def all(self, store: str | None = None) -> list[dict]:
        """[{store, account_id, name, added_at}], oldest first."""
        try:
            rows = json.loads(self.path.read_text(encoding="utf-8")) if self.path.is_file() else []
        except (OSError, ValueError):
            rows = []
        rows = [r for r in rows if isinstance(r, dict) and r.get("store") in STORES and str(r.get("account_id") or "")]
        return [r for r in rows if store is None or r["store"] == store]

    def ids(self, store: str) -> list[str]:
        return [str(r["account_id"]) for r in self.all(store)]

    def add(self, store: str, account_id: str, name: str = "") -> dict:
        if store not in STORES:
            raise ValueError(f"Tienda no soportada: {store}")
        rows = self.all()
        found = next((r for r in rows if r["store"] == store and str(r["account_id"]) == str(account_id)), None)
        if found:
            found["name"] = name or found.get("name", "")
        else:
            found = {"store": store, "account_id": str(account_id), "name": name, "added_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
            rows.append(found)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_json(self.path, rows)
        return found

    def remove(self, store: str, account_id: str) -> bool:
        rows = self.all()
        kept = [r for r in rows if not (r["store"] == store and str(r["account_id"]) == str(account_id))]
        if len(kept) == len(rows):
            return False
        write_json(self.path, kept)
        return True
