"""Visible Steam provider login for manual end-to-end verification.

Unlike ``steam.exe -login user password``, this probe never places credentials
on the process command line. It opens Steam normally and enters locally-loaded
provider credentials into Steam's visible sign-in UI through Windows UI
Automation. If Steam Guard or an unexpected UI appears, it stops and reports
that state so the user can see and handle it.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from typing import Any, Iterable

from pywinauto import Desktop
from pywinauto.keyboard import send_keys

from provider_roster import credential_by_provider_id, match_provider_identities
from steam_switch import find_steam_exe, start_steam, stop_steam


SIGN_IN_TEXTS = (
    "sign in",
    "iniciar sesión",
    "iniciar sesion",
)
ADD_ACCOUNT_TEXTS = (
    "add account",
    "añadir cuenta",
    "agregar cuenta",
    "sign in with another account",
    "iniciar sesión con otra cuenta",
)
GUARD_HINTS = (
    "steam guard",
    "security code",
    "código de seguridad",
    "codigo de seguridad",
    "approve",
    "aprobar",
    "mobile app",
    "aplicación móvil",
)


def _creationflags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _active_user_id32() -> int | None:
    output = subprocess.run(
        ["reg.exe", "query", r"HKCU\Software\Valve\Steam\ActiveProcess", "/v", "ActiveUser"],
        capture_output=True,
        text=True,
        check=False,
        creationflags=_creationflags(),
    )
    if output.returncode != 0:
        return None
    for line in output.stdout.splitlines():
        if "activeuser" not in line.casefold():
            continue
        raw = line.split()[-1]
        try:
            value = int(raw, 16) if raw.lower().startswith("0x") else int(raw)
            return value if value > 0 else None
        except ValueError:
            return None
    return None


def _steam_windows() -> list[Any]:
    windows: list[Any] = []
    desktop = Desktop(backend="uia")
    for win in desktop.windows():
        try:
            title = (win.window_text() or "").strip().casefold()
            pid = win.process_id()
            task = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                check=False,
                creationflags=_creationflags(),
            ).stdout.casefold()
            if "steam" in title or "steam.exe" in task or "steamwebhelper.exe" in task:
                windows.append(win)
        except Exception:
            continue
    return windows


def _controls() -> list[Any]:
    result: list[Any] = []
    seen: set[tuple[int, int]] = set()
    for win in _steam_windows():
        try:
            controls = [win] + list(win.descendants())
        except Exception:
            controls = [win]
        for control in controls:
            try:
                key = (control.process_id(), control.handle)
            except Exception:
                key = (id(control), 0)
            if key in seen:
                continue
            seen.add(key)
            result.append(control)
    return result


def _visible_texts() -> list[str]:
    texts: list[str] = []
    seen: set[str] = set()
    for ctrl in _controls():
        try:
            text = (ctrl.window_text() or "").strip()
        except Exception:
            continue
        if text and text not in seen:
            seen.add(text)
            texts.append(text)
    return texts


def _click_text(candidates: Iterable[str]) -> bool:
    wanted = tuple(item.casefold() for item in candidates)
    for ctrl in _controls():
        try:
            text = (ctrl.window_text() or "").strip().casefold()
        except Exception:
            continue
        if not text or not any(item == text or item in text for item in wanted):
            continue
        for method in ("invoke", "click"):
            try:
                if method == "invoke":
                    ctrl.iface_invoke.Invoke()
                else:
                    ctrl.click_input()
                return True
            except Exception:
                continue
    return False


def _edit_controls() -> list[Any]:
    edits: list[Any] = []
    for ctrl in _controls():
        try:
            if str(ctrl.element_info.control_type).casefold() == "edit" and ctrl.is_visible() and ctrl.is_enabled():
                edits.append(ctrl)
        except Exception:
            continue
    def top_left(ctrl: Any) -> tuple[int, int]:
        try:
            rect = ctrl.rectangle()
            return rect.top, rect.left
        except Exception:
            return (999999, 999999)
    edits.sort(key=top_left)
    return edits


def _fill_edit(ctrl: Any, value: str) -> None:
    try:
        ctrl.set_edit_text(value)
        return
    except Exception:
        pass
    ctrl.click_input()
    send_keys("^a{BACKSPACE}")
    ctrl.type_keys(value, with_spaces=True, set_foreground=True)


def _guard_visible() -> bool:
    joined = " | ".join(_visible_texts()).casefold()
    return any(hint in joined for hint in GUARD_HINTS)


def _expected_identity(provider_id: str) -> dict[str, Any]:
    mapping = match_provider_identities()
    identity = next(
        (item for item in mapping.get("accounts", []) if item.get("provider_id") == provider_id),
        None,
    )
    if not identity or not isinstance(identity.get("user_id32"), int):
        raise RuntimeError(f"{provider_id} has no matching local Steam identity")
    return identity


def login_provider(provider_id: str, timeout_seconds: int = 90) -> dict[str, Any]:
    credential = credential_by_provider_id(provider_id)
    if credential is None:
        raise RuntimeError(f"Unknown provider id: {provider_id}")
    identity = _expected_identity(provider_id)
    expected_user = int(identity["user_id32"])

    if _active_user_id32() == expected_user:
        return {
            "ok": True,
            "stage": "already_active",
            "provider_id": provider_id,
            "expected_user_id32": expected_user,
            "active_user_id32": expected_user,
        }

    stopped = stop_steam(timeout=15)
    if not stopped.ok:
        return {"ok": False, "stage": stopped.stage, "message": stopped.message, "provider_id": provider_id}
    started = start_steam()
    if not started.ok:
        return {"ok": False, "stage": started.stage, "message": started.message, "provider_id": provider_id}

    deadline = time.time() + timeout_seconds
    edits_seen = False
    add_clicked = False
    submitted = False
    while time.time() < deadline:
        active = _active_user_id32()
        if active == expected_user:
            return {
                "ok": True,
                "stage": "ready",
                "provider_id": provider_id,
                "expected_user_id32": expected_user,
                "active_user_id32": active,
                "message": "Steam confirmed the requested provider account",
            }

        if _guard_visible():
            return {
                "ok": False,
                "stage": "guard_required_visible",
                "provider_id": provider_id,
                "expected_user_id32": expected_user,
                "active_user_id32": active,
                "message": "Steam Guard/approval UI is visible; user confirmation is required",
            }

        edits = _edit_controls()
        if len(edits) >= 2 and not submitted:
            edits_seen = True
            _fill_edit(edits[0], credential.login)
            _fill_edit(edits[1], credential.password)
            if not _click_text(SIGN_IN_TEXTS):
                edits[1].click_input()
                send_keys("{ENTER}")
            submitted = True
            time.sleep(1.0)
            continue

        if not add_clicked and _click_text(ADD_ACCOUNT_TEXTS):
            add_clicked = True
            time.sleep(1.0)
            continue

        time.sleep(0.5)

    return {
        "ok": False,
        "stage": "timeout",
        "provider_id": provider_id,
        "expected_user_id32": expected_user,
        "active_user_id32": _active_user_id32(),
        "edits_seen": edits_seen,
        "add_account_clicked": add_clicked,
        "submitted": submitted,
        "visible_text_sample": _visible_texts()[:30],
        "message": "Steam did not confirm the requested provider before timeout",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Visible Steam provider login without credentials in argv")
    parser.add_argument("--provider-id", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=90)
    args = parser.parse_args()
    try:
        result = login_provider(args.provider_id, max(30, args.timeout_seconds))
    except Exception as exc:
        result = {"ok": False, "stage": "error", "error": f"{type(exc).__name__}: {exc}"}
    print(json.dumps(result, ensure_ascii=True))
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
