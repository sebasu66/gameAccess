"""Authoritative Steam license sync using deterministic remembered-account switching.

Steam must be closed before changing its remembered auto-login selector. This
module only edits loginusers.vdf identity flags (MostRecent/AllowAutoLogin) and
HKCU\\Software\\Valve\\Steam\\AutoLoginUser. It never reads or writes passwords,
Steam Guard secrets, cookies, tokens or auth blobs.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

import steam_verified_sync as base
from steam_pool import STEAM_ID64_BASE, _read_vdf, active_user_id32, steam_root
from steam_switch import start_steam

if os.name == "nt":
    import winreg
else:  # pragma: no cover
    winreg = None


def _escape(value: Any) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def _dump_vdf(mapping: dict[str, Any], indent: int = 0) -> str:
    pad = "\t" * indent
    lines: list[str] = []
    for key, value in mapping.items():
        lines.append(f'{pad}"{_escape(key)}"')
        if isinstance(value, dict):
            lines.append(f"{pad}{{")
            lines.append(_dump_vdf(value, indent + 1))
            lines.append(f"{pad}}}")
        else:
            lines[-1] += f'\t\t"{_escape(value)}"'
    return "\n".join(lines)


def _set_remembered_autologin(identity: dict[str, Any]) -> None:
    root = steam_root()
    if not root:
        raise RuntimeError("Steam root not found")
    path = root / "config" / "loginusers.vdf"
    if not path.is_file():
        raise RuntimeError("Steam loginusers.vdf not found")

    parsed = _read_vdf(path)
    users = next((value for key, value in parsed.items() if str(key).casefold() == "users"), None)
    if not isinstance(users, dict):
        raise RuntimeError("Steam loginusers.vdf has no users object")

    target_user32 = int(identity["user_id32"])
    target_steam64 = str(target_user32 + STEAM_ID64_BASE)
    account_name = str(identity.get("account_name") or "").strip()
    if not account_name:
        raise RuntimeError("target account has no AccountName")
    if target_steam64 not in users:
        raise RuntimeError(f"target SteamID {target_steam64} not present in loginusers.vdf")

    now = str(int(time.time()))
    for steam64, info in users.items():
        if not isinstance(info, dict):
            continue
        target = str(steam64) == target_steam64
        info["MostRecent"] = "1" if target else "0"
        info["AllowAutoLogin"] = "1" if target else "0"
        if target:
            info["Timestamp"] = now

    tmp = path.with_suffix(path.suffix + ".gameaccess.tmp")
    tmp.write_text(_dump_vdf(parsed) + "\n", encoding="utf-8")
    tmp.replace(path)

    if winreg is None:
        raise RuntimeError("Windows registry unavailable")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
        winreg.SetValueEx(key, "AutoLoginUser", 0, winreg.REG_SZ, account_name)


def deterministic_switch(identity: dict[str, Any]) -> tuple[bool, str]:
    expected = int(identity["user_id32"])
    if active_user_id32() == expected:
        return True, "already active"

    base.force_close_steam()
    try:
        _set_remembered_autologin(identity)
    except Exception as exc:
        return False, f"configure remembered autologin failed: {exc}"

    started = start_steam()
    if not started.ok:
        return False, f"start failed: {started.stage}: {started.message}"
    if not base.wait_for_active(expected, timeout=60.0):
        return False, f"Steam did not auto-login remembered account {identity.get('account_name')} ({expected})"
    time.sleep(2.0)
    return True, "remembered autologin selected"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--assert-app", type=int)
    parser.add_argument("--assert-copies", type=int)
    args = parser.parse_args()

    # Reuse the already-tested inventory/parser/sync pipeline, replacing only
    # its account switching mechanism for this maintenance run.
    base.switch_verified = deterministic_switch
    inventory = base.verify_inventory()
    if not inventory.get("complete"):
        print(json.dumps({"ok": False, "stage": "verify", "inventory": inventory}, ensure_ascii=False))
        return 2

    if args.assert_app is not None and args.assert_copies is not None:
        owners = {
            int(mapping["owner_user_id32"])
            for mapping in inventory.get("mappings", [])
            if int(mapping.get("app_id") or 0) == args.assert_app
        }
        if len(owners) != args.assert_copies:
            print(json.dumps({
                "ok": False,
                "stage": "assert",
                "app_id": args.assert_app,
                "expected_copies": args.assert_copies,
                "actual_copies": len(owners),
                "owners": sorted(owners),
            }, ensure_ascii=False))
            return 3

    payload = base.build_sync_payload(inventory)
    backend = base.sync_backend(payload, args.api)
    print(json.dumps({
        "ok": True,
        "source": inventory.get("source"),
        "verified_at": inventory.get("verified_at"),
        "complete": inventory.get("complete"),
        "remembered_accounts": inventory.get("remembered_account_count"),
        "scanned_accounts": inventory.get("scanned_account_count"),
        "catalog_games": len(payload.get("games", [])),
        "unique_windows_games_owned": inventory.get("unique_windows_games"),
        "license_mappings": inventory.get("license_mappings"),
        "owners": [
            {"label": owner.get("label"), "user_id32": owner.get("user_id32"), "game_count": owner.get("game_count")}
            for owner in inventory.get("owners", [])
        ],
        "backend": backend,
        "restore_error": inventory.get("restore_error"),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
