"""Authoritative Steam license sync with silent remembered-account startup.

Steam's current client supports ``-silent`` startup without showing the login
chooser when remembered auto-login is configured. We close all user Steam
processes, select the target using Steam's own loginusers/AutoLoginUser settings,
and relaunch silently. No credentials or auth material are read or written.
"""
from __future__ import annotations

import os
import subprocess
import time
from typing import Any

import steam_verified_sync_v2 as v2
from steam_pool import STEAM_ID64_BASE, _read_vdf, active_user_id32, steam_root
from steam_switch import find_steam_exe

if os.name == "nt":
    import winreg
else:  # pragma: no cover
    winreg = None


def deep_close() -> None:
    for image in ("steam.exe", "steamwebhelper.exe", "steamerrorreporter.exe"):
        subprocess.run(
            ["taskkill", "/F", "/T", "/IM", image],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    time.sleep(2.5)


def configure_target(identity: dict[str, Any]) -> None:
    # Reuse the tested MostRecent/AllowAutoLogin + AutoLoginUser update.
    v2._set_remembered_autologin(identity)

    root = steam_root()
    if not root:
        raise RuntimeError("Steam root not found")
    path = root / "config" / "loginusers.vdf"
    parsed = _read_vdf(path)
    users = next((value for key, value in parsed.items() if str(key).casefold() == "users"), None)
    if not isinstance(users, dict):
        raise RuntimeError("Steam loginusers.vdf has no users object")

    target64 = str(int(identity["user_id32"]) + STEAM_ID64_BASE)
    target = users.get(target64)
    if not isinstance(target, dict):
        raise RuntimeError("target remembered user block not found")
    # This does not contain a password; it only tells Steam to reuse its own
    # already-stored remembered-login credential for this account.
    target["RememberPassword"] = "1"
    target["AllowAutoLogin"] = "1"
    target["MostRecent"] = "1"

    tmp = path.with_suffix(path.suffix + ".gameaccess.tmp")
    tmp.write_text(v2._dump_vdf(parsed) + "\n", encoding="utf-8")
    tmp.replace(path)

    if winreg is not None:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            winreg.SetValueEx(key, "AutoLoginUser", 0, winreg.REG_SZ, str(identity.get("account_name") or ""))
            winreg.SetValueEx(key, "RememberPassword", 0, winreg.REG_DWORD, 1)


def silent_switch(identity: dict[str, Any]) -> tuple[bool, str]:
    expected = int(identity["user_id32"])
    if active_user_id32() == expected:
        return True, "already active"

    deep_close()
    try:
        configure_target(identity)
    except Exception as exc:
        return False, f"configure remembered login failed: {exc}"

    steam = find_steam_exe()
    if not steam:
        return False, "Steam executable not found"
    try:
        subprocess.Popen([str(steam), "-silent"], close_fds=True)
    except OSError as exc:
        return False, f"could not start Steam -silent: {exc}"

    if not v2.base.wait_for_active(expected, timeout=60.0):
        return False, f"Steam -silent did not activate {identity.get('account_name')} ({expected})"
    time.sleep(2.0)
    return True, "remembered account activated with Steam -silent"


if __name__ == "__main__":
    v2.deterministic_switch = silent_switch
    raise SystemExit(v2.main())
