"""Probe a remembered Steam account switch using visible startup chooser fallback.

This is a maintenance diagnostic for gameAccess. It never reads or enters Steam
credentials. It uses only Steam's existing remembered-login state and, if silent
autologin does not activate the target, clicks the target card in Steam's visible
startup chooser via UI Automation.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time

from steam_pool import active_user_id32, remembered_account_identities
from steam_switch import _normalize, _steam_windows, find_steam_exe, remembered_accounts
from steam_verified_sync_v4 import configure_target, deep_close


def find_identity(label: str) -> dict | None:
    target = label.casefold().strip()
    return next(
        (
            item
            for item in remembered_account_identities()
            if str(item.get("account_name") or "").casefold() == target
            or str(item.get("display_name") or "").casefold() == target
        ),
        None,
    )


def click_visible_account(identity: dict, timeout: float = 35.0) -> tuple[bool, str]:
    aliases = {
        _normalize(str(identity.get("display_name") or "")),
        _normalize(str(identity.get("account_name") or "")),
    }
    aliases.discard("")
    deadline = time.time() + timeout
    last_visible: list[str] = []
    while time.time() < deadline:
        if active_user_id32() == int(identity["user_id32"]):
            return True, "target became active before chooser click"
        cards = remembered_accounts()
        last_visible = [card.label for card in cards]
        for win in _steam_windows():
            try:
                controls = [win] + list(win.descendants())
            except Exception:
                controls = [win]
            for ctrl in controls:
                try:
                    text = (ctrl.window_text() or "").strip()
                except Exception:
                    continue
                if _normalize(text) not in aliases:
                    continue
                try:
                    ctrl.iface_invoke.Invoke()
                except Exception:
                    try:
                        ctrl.click_input()
                    except Exception:
                        continue
                return True, f"clicked visible remembered account card: {text}"
        time.sleep(0.5)
    return False, f"target card not clickable; visible remembered accounts: {last_visible}"


def wait_active(expected: int, timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if active_user_id32() == expected:
            return True
        time.sleep(0.5)
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("account")
    args = parser.parse_args()
    identity = find_identity(args.account)
    if not identity:
        print(json.dumps({"ok": False, "error": "remembered account not found"}))
        return 2

    expected = int(identity["user_id32"])
    deep_close()
    try:
        configure_target(identity)
    except Exception as exc:
        print(json.dumps({"ok": False, "stage": "configure", "error": str(exc)}))
        return 3

    steam = find_steam_exe()
    if not steam:
        print(json.dumps({"ok": False, "stage": "start", "error": "Steam executable not found"}))
        return 4
    subprocess.Popen([str(steam)], close_fds=True)

    # Give normal remembered autologin a short chance first.
    if wait_active(expected, 15.0):
        print(json.dumps({"ok": True, "mode": "autologin", "active_user_id32": expected}))
        return 0

    clicked, message = click_visible_account(identity)
    if clicked and wait_active(expected, 60.0):
        print(json.dumps({"ok": True, "mode": "visible-chooser", "message": message, "active_user_id32": expected}, ensure_ascii=False))
        return 0

    print(json.dumps({
        "ok": False,
        "mode": "visible-chooser",
        "message": message,
        "expected_user_id32": expected,
        "active_user_id32": active_user_id32(),
    }, ensure_ascii=False))
    return 5


if __name__ == "__main__":
    raise SystemExit(main())
