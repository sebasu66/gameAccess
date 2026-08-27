"""Inspect Steam console UIA controls without reading auth/session data."""
from __future__ import annotations

import json
import subprocess
import time

from steam_switch import find_steam_exe, _steam_windows, active_user_id32 if False else None

# Import active_user_id32 from steam_pool to avoid changing steam_switch API.
from steam_pool import active_user_id32, remembered_account_identities


def safe_text(value: str) -> str:
    value = (value or "").strip()
    # Do not emit long console/library content. Names are enough to identify controls.
    if len(value) > 120:
        return value[:117] + "..."
    return value


def main() -> int:
    steam = find_steam_exe()
    if not steam:
        print(json.dumps({"ok": False, "error": "Steam not found"}))
        return 1
    subprocess.Popen([str(steam), "steam://nav/console"], close_fds=True)
    time.sleep(4)

    controls = []
    for win in _steam_windows():
        try:
            win_title = safe_text(win.window_text())
            descendants = [win] + list(win.descendants())
        except Exception:
            continue
        for ctrl in descendants:
            try:
                info = ctrl.element_info
                control_type = str(info.control_type or "")
                name = safe_text(ctrl.window_text())
                automation_id = str(info.automation_id or "")
                class_name = str(info.class_name or "")
            except Exception:
                continue
            if control_type in {"Edit", "Document", "Text", "Pane", "Button", "TabItem"}:
                controls.append({
                    "window": win_title,
                    "type": control_type,
                    "name": name,
                    "automation_id": automation_id,
                    "class_name": class_name,
                })
            if len(controls) >= 300:
                break
        if len(controls) >= 300:
            break

    active = active_user_id32()
    identity = next((x for x in remembered_account_identities() if x.get("user_id32") == active), None)
    print(json.dumps({"ok": True, "active_user_id32": active, "active_identity": identity, "controls": controls}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
