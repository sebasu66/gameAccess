from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LAUNCHER_DIR = PROJECT_ROOT / "apps" / "launcher"
sys.path.insert(0, str(LAUNCHER_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from provider_roster import load_provider_credentials  # noqa: E402
from transfer import send  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch Steam inventory consolidation into one destination account")
    parser.add_argument("target_steam_id64", help="destination SteamID64")
    parser.add_argument("--execute", action="store_true", help="Actually send offers; default is dry-run")
    parser.add_argument("--account", action="append", default=[], help="Limit to provider ID/label/login; repeatable")
    parser.add_argument("--out", type=Path, default=PROJECT_ROOT / "debug" / "inventory-transfer-batch.json")
    args = parser.parse_args()

    credentials = load_provider_credentials()
    wanted = {value.casefold() for value in args.account}
    selected = [
        credential
        for credential in credentials
        if not wanted
        or credential.provider_id.casefold() in wanted
        or credential.label.casefold() in wanted
        or credential.login.casefold() in wanted
    ]
    trade_url = os.environ.get("GA_TRADE_URL") or None

    results = []
    for index, credential in enumerate(selected, start=1):
        print(f"[{index}/{len(selected)}] {credential.provider_id} {credential.label}", flush=True)
        try:
            result = send(
                credential.provider_id,
                args.target_steam_id64,
                execute=args.execute,
                trade_url=trade_url,
            )
        except Exception as exc:
            result = {
                "status": "error",
                "provider_id": credential.provider_id,
                "label": credential.label,
                "error": f"{type(exc).__name__}: {exc}"[:500],
            }
        results.append(result)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(
                {
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "execute": bool(args.execute),
                    "target_steam_id64": args.target_steam_id64,
                    "account_count": len(selected),
                    "completed_count": len(results),
                    "results": results,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    summary = {
        "status": "ok",
        "execute": bool(args.execute),
        "account_count": len(selected),
        "sent_count": sum(1 for row in results if row.get("status") == "sent"),
        "nothing_to_send_count": sum(1 for row in results if row.get("status") == "nothing_to_send"),
        "planned_item_count": sum(len(row.get("items") or row.get("selected_items") or []) for row in results),
        "failed_count": sum(1 for row in results if row.get("status") not in {"ok", "sent", "nothing_to_send"}),
        "out": str(args.out),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["failed_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
