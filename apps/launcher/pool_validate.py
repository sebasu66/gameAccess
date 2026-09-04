"""Reversible local validation for the gameAccess Steam pool MVP."""

from __future__ import annotations

import argparse
import json
import subprocess
import time

import requests

from steam_pool import active_user_id32, remembered_account_identities
from steam_switch import find_steam_exe, switch_to_remembered_account


def validate(app_id: int, api: str = "http://127.0.0.1:38147", minutes: int = 5) -> dict:
    catalog = requests.get(f"{api}/catalog", timeout=10).json()
    game = next((item for item in catalog if item.get("app_id") == app_id), None)
    if not game:
        raise RuntimeError(f"AppID {app_id} is not in the active gameAccess catalog")

    credits_before = requests.get(f"{api}/users/1", timeout=10).json()["credits"]
    lease_response = requests.post(
        f"{api}/leases",
        json={"user_id": 1, "game_id": game["id"], "minutes": minutes},
        timeout=10,
    )
    lease_response.raise_for_status()
    lease = lease_response.json()

    try:
        label = lease["account"]["label"]
        switch = switch_to_remembered_account(label)
        identities = remembered_account_identities()
        expected_user = next(
            (item.get("user_id32") for item in identities if item.get("display_name") == label),
            None,
        )
        active_user = active_user_id32()

        steam = find_steam_exe()
        if steam:
            subprocess.Popen([str(steam), f"steam://install/{app_id}"])
        time.sleep(5)

        return {
            "game": game["name"],
            "lease_id": lease["lease_id"],
            "lease_account": label,
            "switch_ok": switch.ok,
            "switch_stage": switch.stage,
            "switch_message": switch.message,
            "expected_user_id32": expected_user,
            "active_user_id32": active_user,
            "active_matches": expected_user == active_user and expected_user is not None,
            "credits_before": credits_before,
            "credits_spent": lease["credits_spent"],
        }
    finally:
        # This is a diagnostic lease only: always release the account and refund
        # exactly what the test charged so the pool returns to its prior state.
        requests.post(f"{api}/leases/{lease['lease_id']}/release", timeout=10).raise_for_status()
        requests.post(
            f"{api}/credits",
            json={
                "user_id": 1,
                "amount": lease["credits_spent"],
                "reason": f"pool-test-refund:{lease['lease_id']}",
            },
            timeout=10,
        ).raise_for_status()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("app_id", type=int)
    parser.add_argument("--api", default="http://127.0.0.1:38147")
    parser.add_argument("--minutes", type=int, default=5)
    args = parser.parse_args()
    result = validate(args.app_id, args.api, args.minutes)
    result["credits_after"] = requests.get(f"{args.api}/users/1", timeout=10).json()["credits"]
    catalog = requests.get(f"{args.api}/catalog", timeout=10).json()
    game = next(item for item in catalog if item.get("app_id") == args.app_id)
    result["copies_total_after"] = game["copies_total"]
    result["copies_available_after"] = game["copies_available"]
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("switch_ok") and result.get("active_matches") else 1


if __name__ == "__main__":
    raise SystemExit(main())
