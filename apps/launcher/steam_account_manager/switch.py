"""Signs Steam in to the account that owns a game, then runs it.

Only the accounts Steam already remembers: Game Access sets Steam's own auto-login account (`AutoLoginUser` under
`HKCU\\Software\\Valve\\Steam`) and restarts Steam, which signs in with the token it saved when "Remember me" was
ticked. No password is read, stored or typed. When Steam needs the password or a Steam Guard code anyway, its own
login window opens with the account already chosen and the switch waits for the user to finish there."""
from __future__ import annotations
import os
import subprocess
import time
from pathlib import Path
from .client import STEAM_ID64_BASE

STEAM_KEY = r"Software\Valve\Steam"
LOGIN_TIMEOUT = 180.0
SHUTDOWN_TIMEOUT = 40.0


def _start_flags() -> list[str]:
    """In a child's account (kid mode, kid_mode.rs sets GAMEACCESS_STEAM_SILENT) Steam starts minimised: after signing in
    it must not open its library, where any game could be started."""
    return ["-silent"] if os.environ.get("GAMEACCESS_STEAM_SILENT") == "1" else []


def _flags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


def active_account_id() -> int:
    """The account Steam is signed in to now (32-bit id), 0 when Steam is closed or signed out."""
    if os.name != "nt":
        return 0
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, STEAM_KEY + r"\ActiveProcess") as key:
            return int(winreg.QueryValueEx(key, "ActiveUser")[0] or 0)
    except (ImportError, OSError, ValueError):
        return 0


def active_id64() -> str:
    account = active_account_id()
    return str(account + STEAM_ID64_BASE) if account else ""


def steam_running() -> bool:
    if os.name != "nt":
        return False
    # Bytes, not text: tasklist answers in the console code page ("INFORMACIÓN" in cp850), which is not UTF-8.
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq steam.exe", "/NH"], capture_output=True,
                         check=False, creationflags=_flags()).stdout or b""
    return b"steam.exe" in out.lower()


def set_auto_login(account_name: str) -> None:
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, STEAM_KEY, 0, winreg.KEY_SET_VALUE) as key:
        winreg.SetValueEx(key, "AutoLoginUser", 0, winreg.REG_SZ, account_name)
        winreg.SetValueEx(key, "RememberPassword", 0, winreg.REG_DWORD, 1)


def _wait(condition, timeout: float, step: float = 0.5, sleep=time.sleep, clock=time.monotonic) -> bool:
    deadline = clock() + timeout
    while clock() < deadline:
        if condition():
            return True
        sleep(step)
    return condition()


class SteamSwitcher:
    """The steps are injectable so the order (close, choose account, start, wait) is tested without a real Steam."""

    def __init__(self, steam_exe: Path, logger, active=active_account_id, running=steam_running, auto_login=set_auto_login,
                 start=None, sleep=time.sleep, clock=time.monotonic):
        self.steam_exe = Path(steam_exe)
        self.log = logger
        self.active, self.running, self.auto_login = active, running, auto_login
        self.start = start or (lambda *args: subprocess.Popen([str(self.steam_exe), *args], close_fds=True, creationflags=_flags()))
        self.sleep, self.clock = sleep, clock

    def close(self, too_slow: str = "Steam no se cerró a tiempo. Cerralo y volvé a intentar.") -> bool:
        """Close Steam when it is running (and wait for it); True when it had to be closed."""
        if not self.running():
            return False
        self.start("-shutdown")
        if not _wait(lambda: not self.running(), SHUTDOWN_TIMEOUT, sleep=self.sleep, clock=self.clock):
            raise RuntimeError(too_slow)
        return True

    def ensure_account(self, account_id: int, account_name: str, login_timeout: float = LOGIN_TIMEOUT) -> dict:
        """Steam signed in to `account_id`, switching only when another account (or none) is active."""
        current = self.active()
        if current == account_id:
            return {"switched": False, "account": account_name}
        self.log.info("Steam: switching from account %s to %s", current or "none", account_name)
        self.close("Steam no se cerró a tiempo para cambiar de cuenta. Cerralo y volvé a intentar.")
        self.auto_login(account_name)
        self.start(*_start_flags())
        if not _wait(lambda: self.active() == account_id, login_timeout, step=1.0, sleep=self.sleep, clock=self.clock):
            raise RuntimeError(f"Steam no inició sesión con {account_name}. Si te pidió la contraseña, ingresala en Steam y volvé a jugar.")
        self.log.info("Steam: signed in as %s", account_name)
        return {"switched": True, "account": account_name}
