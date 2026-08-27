"""Hybrid remembered-account switch for authoritative Steam license verification.

Some Steam clients are configured to always show the startup account chooser.
We still preselect the target through MostRecent/AutoLoginUser, then, if Steam
shows the chooser instead of auto-login, click the remembered account visibly.
"""
from __future__ import annotations

import time
from typing import Any

import steam_verified_sync_v2 as v2
from steam_pool import active_user_id32
from steam_switch import select_remembered_account, start_steam


def hybrid_switch(identity: dict[str, Any]) -> tuple[bool, str]:
    expected = int(identity["user_id32"])
    if active_user_id32() == expected:
        return True, "already active"

    v2.base.force_close_steam()
    try:
        v2._set_remembered_autologin(identity)
    except Exception as exc:
        return False, f"configure remembered autologin failed: {exc}"

    started = start_steam()
    if not started.ok:
        return False, f"start failed: {started.stage}: {started.message}"

    # If Steam is configured for automatic login this is enough.
    if v2.base.wait_for_active(expected, timeout=10.0):
        time.sleep(2.0)
        return True, "remembered autologin selected"

    # If "Ask which account to use on startup" is enabled, Steam deliberately
    # stops at the visible chooser. Click the already remembered account there.
    target = str(identity.get("account_name") or identity.get("display_name") or "").strip()
    selected = select_remembered_account(target, timeout=30.0)
    if not selected.ok:
        return False, f"startup chooser selection failed: {selected.stage}: {selected.message}"
    if not v2.base.wait_for_active(expected, timeout=50.0):
        return False, f"chooser selected {target} but ActiveUser did not become {expected}"
    time.sleep(2.0)
    return True, "selected from Steam startup chooser"


if __name__ == "__main__":
    v2.deterministic_switch = hybrid_switch
    raise SystemExit(v2.main())
