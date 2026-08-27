from __future__ import annotations

import argparse
import json

from steam_pool import active_user_id32, remembered_account_identities
from steam_verified_sync_v4 import silent_switch


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("account")
    args = parser.parse_args()
    target = args.account.casefold()
    identity = next(
        (
            item for item in remembered_account_identities()
            if str(item.get("account_name") or "").casefold() == target
            or str(item.get("display_name") or "").casefold() == target
        ),
        None,
    )
    if not identity:
        print(json.dumps({"ok": False, "error": "account not found"}))
        return 2
    ok, message = silent_switch(identity)
    result = {
        "ok": ok,
        "message": message,
        "expected_user_id32": identity.get("user_id32"),
        "active_user_id32": active_user_id32(),
        "account_name": identity.get("account_name"),
        "display_name": identity.get("display_name"),
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0 if ok else 3


if __name__ == "__main__":
    raise SystemExit(main())
