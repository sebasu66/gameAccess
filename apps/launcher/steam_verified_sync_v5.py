"""Deterministic Steam remembered-account switch for verified license scanning.

Uses Steam's own remembered-login selectors and temporarily disables the client
startup chooser so an admin verification can iterate accounts unattended. Only
non-secret login-selection flags are changed; no passwords/tokens/auth blobs are
read or written.
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
    time.sleep(2.0)


def _write_vdf(path, parsed) -> None:
    tmp = path.with_suffix(path.suffix + ".gameaccess.tmp")
    tmp.write_text(v2._dump_vdf(parsed) + "\n", encoding="utf-8")
    tmp.replace(path)


def configure_target(identity: dict[str, Any]) -> None:
    root = steam_root()
    if not root:
        raise RuntimeError("Steam root not found")

    login_path = root / "config" / "loginusers.vdf"
    login = _read_vdf(login_path)
    users = next((value for key, value in login.items() if str(key).casefold() == "users"), None)
    if not isinstance(users, dict):
        raise RuntimeError("loginusers.vdf has no users object")

    target32 = int(identity["user_id32"])
    target64 = str(target32 + STEAM_ID64_BASE)
    if target64 not in users:
        raise RuntimeError("target account is not remembered by Steam")
    now = str(int(time.time()))
    for steam64, info in users.items():
        if not isinstance(info, dict):
            continue
        selected = str(steam64) == target64
        bit = "1" if selected else "0"
        info["MostRecent"] = bit
        info["AllowAutoLogin"] = bit
        info["AutoLogin"] = bit
        if selected:
            info["RememberPassword"] = "1"
            info["Timestamp"] = now
    _write_vdf(login_path, login)

    config_path = root / "config" / "config.vdf"
    config = _read_vdf(config_path)
    try:
        config["InstallConfigStore"]["WebStorage"]["Auth"]["AlwaysShowUserChooser"] = "0"
    except Exception as exc:
        raise RuntimeError(f"AlwaysShowUserChooser setting not found: {exc}") from exc
    _write_vdf(config_path, config)

    account_name = str(identity.get("account_name") or "").strip()
    if not account_name:
        raise RuntimeError("target account has no AccountName")
    if winreg is None:
        raise RuntimeError("Windows registry unavailable")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
        winreg.SetValueEx(key, "AutoLoginUser", 0, winreg.REG_SZ, account_name)
        winreg.SetValueEx(key, "RememberPassword", 0, winreg.REG_DWORD, 1)


def deterministic_switch(identity: dict[str, Any]) -> tuple[bool, str]:
    expected = int(identity["user_id32"])
    if active_user_id32() == expected:
        return True, "already active"

    deep_close()
    try:
        configure_target(identity)
    except Exception as exc:
        return False, f"configure target failed: {exc}"

    steam = find_steam_exe()
    if not steam:
        return False, "Steam executable not found"
    try:
        subprocess.Popen([str(steam), "-silent"], close_fds=True)
    except OSError as exc:
        return False, f"Steam start failed: {exc}"

    if not v2.base.wait_for_active(expected, timeout=60.0):
        return False, f"Steam did not activate remembered account {identity.get('account_name')} ({expected})"
    time.sleep(2.0)
    return True, "remembered account selected deterministically"


if __name__ == "__main__":
    v2.deterministic_switch = deterministic_switch
    raise SystemExit(v2.main())
