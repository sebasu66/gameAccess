from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TRANSFER_DIR = PROJECT_ROOT / "tools" / "steam_inventory_transfer"
NODE_SENDER = TRANSFER_DIR / "send_offer.js"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from authenticated import close_steam, find_credential  # noqa: E402
from transfer_plan import build_plan  # noqa: E402


def ensure_node_dependencies() -> None:
    if (TRANSFER_DIR / "node_modules" / "steam-user").is_dir() and (TRANSFER_DIR / "node_modules" / "steam-tradeoffer-manager").is_dir():
        return
    completed = subprocess.run(
        ["npm", "install", "--omit=dev", "--no-audit", "--no-fund"],
        cwd=TRANSFER_DIR,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=180,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "npm install failed").strip()[-3000:])


def send(account: str, target_steam_id64: str, *, execute: bool = False) -> dict:
    plan = build_plan(account)
    plan["target_steam_id64"] = target_steam_id64
    if plan.get("status") != "ok" or not execute:
        plan["execute"] = False
        return plan
    if not str(target_steam_id64).isdigit():
        raise RuntimeError("target SteamID64 must be numeric")

    credential = find_credential(account)
    ensure_node_dependencies()
    close_steam()

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False, dir=PROJECT_ROOT / "debug") as handle:
        json.dump(plan, handle, ensure_ascii=False, indent=2)
        plan_path = Path(handle.name)

    env = os.environ.copy()
    env["GA_STEAM_USER"] = credential.login
    env["GA_STEAM_PASS"] = credential.password
    env["GA_TRADE_TARGET_STEAMID64"] = str(target_steam_id64)
    try:
        completed = subprocess.run(
            ["node", str(NODE_SENDER), str(plan_path)],
            cwd=TRANSFER_DIR,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=120,
        )
    finally:
        try:
            plan_path.unlink()
        except OSError:
            pass

    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        return {
            "status": "sender_error",
            "error": (completed.stderr or "trade sender returned no JSON").strip()[-2000:],
            "provider_id": plan.get("provider_id"),
            "label": plan.get("label"),
            "item_count": len(plan.get("items") or []),
        }
    try:
        result = json.loads(lines[-1])
    except json.JSONDecodeError:
        result = {"status": "sender_error", "error": "trade sender returned invalid JSON"}
    if not isinstance(result, dict):
        result = {"status": "sender_error", "error": "trade sender returned non-object JSON"}
    result["provider_id"] = plan.get("provider_id")
    result["label"] = plan.get("label")
    result["selected_items"] = [
        {
            "appid": item.get("appid"),
            "contextid": item.get("contextid"),
            "assetid": item.get("assetid"),
            "amount": item.get("amount"),
            "name": item.get("name"),
            "market_hash_name": item.get("market_hash_name"),
        }
        for item in plan.get("items") or []
    ]
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Consolidate tradable+marketable Steam inventory items into one Steam account")
    parser.add_argument("account", help="provider ID, label, or Steam login")
    parser.add_argument("target_steam_id64", help="destination SteamID64")
    parser.add_argument("--execute", action="store_true", help="Actually create the trade offer; default is dry-run")
    args = parser.parse_args()

    result = send(args.account, args.target_steam_id64, execute=args.execute)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("status") in {"ok", "sent", "nothing_to_send"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
