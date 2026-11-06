"""Prototype of Game Boost: free the PC for a game, then put everything back.

apply    suspend background apps, lower priority + EcoQoS on the rest, stop non-essential
         services, trim memory. The previous state is written to a file BEFORE changing it.
restore  undo everything recorded in that file (also after a crash).
status   show what is currently applied.

Needs an administrator Python for services and the standby-list purge; the rest works for the
user's own processes without it. Windows only.
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
import sys
import time
from ctypes import wintypes
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATE_FILE = ROOT / ".cache" / "benchmarks" / "tune-state.json"

# Apps that do nothing for a game while it runs; they and their child processes get suspended.
SUSPEND = {
    "chatgpt.exe", "chrome.exe", "msedge.exe", "brave.exe", "firefox.exe", "opera.exe", "utweb.exe",
    "reallusion hub.exe", "braveupdate.exe", "game access torrent provider.exe", "gameaccess-desktop.exe",
    "postgres.exe", "spline.exe", "codex.exe", "codex-computer-use-swift.exe", "crossdeviceservice.exe",
    "crossdeviceresume.exe", "asusosd.exe", "asusoptimizationstartuptask.exe", "widgets.exe",
    "widgetservice.exe", "openvpn-gui.exe", "onedrive.exe", "dropbox.exe",
    "googledrivefs.exe", "epicgameslauncher.exe", "battle.net.exe", "eadesktop.exe", "upc.exe",
    "galaxyclient.exe", "discord.exe", "spotify.exe", "teams.exe", "ms-teams.exe", "slack.exe",
}
# Apps closed in order (like Windows Update's Restart Manager does) and reopened afterwards, so their
# memory is really freed. Only when we can read their path to reopen them; otherwise they get suspended.
CLOSE = {
    "chatgpt.exe", "chrome.exe", "utweb.exe", "gameaccess-desktop.exe", "msedge.exe", "brave.exe", "firefox.exe",
    "discord.exe", "spotify.exe", "epicgameslauncher.exe", "onedrive.exe", "dropbox.exe", "slack.exe", "teams.exe",
}
# Never suspended, never deprioritized: Windows itself, input/audio/display, security, drivers,
# the measuring tools and the benchmark/game.
PROTECTED = {
    "system", "idle", "registry", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe",
    "lsass.exe", "svchost.exe", "dwm.exe", "explorer.exe", "fontdrvhost.exe", "sihost.exe", "ctfmon.exe",
    "audiodg.exe", "taskhostw.exe", "shellexperiencehost.exe", "startmenuexperiencehost.exe", "searchhost.exe",
    "textinputhost.exe", "tabtip.exe", "shellhost.exe", "runtimebroker.exe", "msmpeng.exe", "nissrv.exe",
    "securityhealthsystray.exe", "securityhealthservice.exe", "defendersessionhelper.exe", "nvdisplay.container.exe",
    "nvcontainer.exe", "gameinputsvc.exe", "gameinputredistservice.exe", "lsm.exe", "useroobebroker.exe",
    "heaven.exe", "superposition.exe", "launcher.exe",
}
# Process trees that must keep running (the agent driving this test and its tools): never
# suspended, but still lowered to below-normal priority + EcoQoS like any other background app.
KEEP_RUNNING_ROOTS = {"claude.exe"}
SERVICES = [
    "SysMain", "WSearch", "Spooler", "DiagTrack", "DoSvc",
    "AsusAppService", "ASUSOptimization", "ASUSSoftwareManager", "ASUSSwitch", "ASUSSystemAnalysis",
    "ASUSSystemDiagnosis", "VirtualDesktop.Service.exe",
]
SERVICE_PREFIXES = ["GooglePlayGamesServices"]

PROCESS_SET_QUOTA, PROCESS_SET_INFORMATION, PROCESS_SUSPEND_RESUME = 0x0100, 0x0200, 0x0800
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
BELOW_NORMAL, NORMAL, ABOVE_NORMAL = 0x4000, 0x20, 0x8000
PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1
ProcessPowerThrottling = 4

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True) if os.name == "nt" else None
ntdll = ctypes.WinDLL("ntdll") if os.name == "nt" else None
psapi = ctypes.WinDLL("psapi") if os.name == "nt" else None
advapi32 = ctypes.WinDLL("advapi32", use_last_error=True) if os.name == "nt" else None


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_void_p), ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD),
                ("szExeFile", ctypes.c_wchar * 260)]


class POWER_THROTTLING_STATE(ctypes.Structure):
    _fields_ = [("Version", wintypes.ULONG), ("ControlMask", wintypes.ULONG), ("StateMask", wintypes.ULONG)]


if kernel32:
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.GetPriorityClass.argtypes = [wintypes.HANDLE]
    kernel32.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel32.SetProcessInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    ntdll.NtSuspendProcess.argtypes = ntdll.NtResumeProcess.argtypes = [wintypes.HANDLE]
    psapi.EmptyWorkingSet.argtypes = [wintypes.HANDLE]


def processes() -> list[dict]:
    snapshot = kernel32.CreateToolhelp32Snapshot(0x2, 0)
    entry = PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(entry)
    result = []
    ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
    while ok:
        session = wintypes.DWORD()
        kernel32.ProcessIdToSessionId(entry.th32ProcessID, ctypes.byref(session))
        result.append({"pid": entry.th32ProcessID, "ppid": entry.th32ParentProcessID,
                       "name": entry.szExeFile.lower(), "session": session.value})
        ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    kernel32.CloseHandle(snapshot)
    return result


def open_process(pid: int, access: int):
    return kernel32.OpenProcess(access | PROCESS_QUERY_LIMITED_INFORMATION, False, pid) or None


def created(handle) -> int:
    """Creation time identifies a process; a recycled PID must never be resumed or changed."""
    times = [wintypes.FILETIME() for _ in range(4)]
    kernel32.GetProcessTimes(handle, *map(ctypes.byref, times))
    return (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime


def descendants(procs: list[dict], roots: set[int]) -> set[int]:
    found, changed = set(roots), True
    while changed:
        changed = False
        for proc in procs:
            if proc["ppid"] in found and proc["pid"] not in found and proc["pid"] != proc["ppid"]:
                found.add(proc["pid"])
                changed = True
    return found


def set_ecoqos(handle, on: bool) -> bool:
    # on: EcoQoS (efficiency cores, lower clocks). off: hand the decision back to Windows.
    state = POWER_THROTTLING_STATE(1, PROCESS_POWER_THROTTLING_EXECUTION_SPEED if on else 0,
                                   PROCESS_POWER_THROTTLING_EXECUTION_SPEED if on else 0)
    return bool(kernel32.SetProcessInformation(handle, ProcessPowerThrottling, ctypes.byref(state), ctypes.sizeof(state)))


def protected_pids(procs: list[dict]) -> set[int]:
    by_pid = {p["pid"]: p for p in procs}
    keep = {p["pid"] for p in procs if p["name"] in PROTECTED or p["session"] == 0}
    pid = os.getpid()  # this script and everything that started it
    while pid in by_pid and pid not in (0, 4):
        keep.add(pid)
        pid = by_pid[pid]["ppid"]
    return keep


def save(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=1), encoding="utf-8")


def purge_standby_list() -> str:
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE  # the pseudo-handle -1 must stay 64-bit
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.AdjustTokenPrivileges.argtypes = [wintypes.HANDLE, wintypes.BOOL, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p]
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0020 | 0x0008, ctypes.byref(token)):
        return f"OpenProcessToken failed ({ctypes.get_last_error()})"
    luid = ctypes.c_int64()
    if not advapi32.LookupPrivilegeValueW(None, "SeProfileSingleProcessPrivilege", ctypes.byref(luid)):
        return "privilege lookup failed"
    privileges = (ctypes.c_ulong * 4)(1, luid.value & 0xFFFFFFFF, luid.value >> 32, 2)
    advapi32.AdjustTokenPrivileges(token, False, ctypes.byref(privileges), 0, None, None)
    error = ctypes.get_last_error()
    kernel32.CloseHandle(token)
    if error != 0:
        return f"not elevated, skipped ({error})"
    command = ctypes.c_int(4)  # MemoryPurgeStandbyList
    status = ntdll.NtSetSystemInformation(80, ctypes.byref(command), ctypes.sizeof(command))
    return "purged" if status == 0 else f"failed 0x{status & 0xFFFFFFFF:08X}"


def running_services() -> list[str]:
    names = SERVICES + [f"{prefix}*" for prefix in SERVICE_PREFIXES]
    script = ("Get-Service -Name " + ",".join(f"'{n}'" for n in names) +
              " -ErrorAction SilentlyContinue | Where-Object Status -eq 'Running' | ForEach-Object Name")
    out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", script], capture_output=True, text=True)
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


def services(action: str, names: list[str]) -> dict:
    result = {}
    for name in names:
        command = f"{action}-Service -Name '{name}' -Force -ErrorAction Stop" if action == "Stop" else f"Start-Service -Name '{name}' -ErrorAction Stop"
        out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", command], capture_output=True, text=True)
        result[name] = "ok" if out.returncode == 0 else (out.stderr.strip().splitlines() or ["error"])[0][:120]
    return result


class ANIMATIONINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("iMinAnimate", ctypes.c_int)]


# SystemParametersInfo get/set pairs for the "look nice" effects; True = effect on.
VISUAL_FLAGS = {"ui_effects": (0x103E, 0x103F), "client_animation": (0x1042, 0x1043),
                "drop_shadow": (0x1024, 0x1025), "cursor_shadow": (0x101A, 0x101B)}
PERSONALIZE = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"


def visual_effects_off() -> dict:
    """Animations, shadows, fades and transparency off; returns the previous values."""
    user32 = ctypes.WinDLL("user32")
    old = {}
    for name, (get, set_) in VISUAL_FLAGS.items():
        value = wintypes.BOOL()
        user32.SystemParametersInfoW(get, 0, ctypes.byref(value), 0)
        old[name] = bool(value.value)
        user32.SystemParametersInfoW(set_, 0, ctypes.c_void_p(0), 2)  # SPIF_SENDCHANGE
    animation = ANIMATIONINFO(ctypes.sizeof(ANIMATIONINFO), 0)
    user32.SystemParametersInfoW(0x0048, animation.cbSize, ctypes.byref(animation), 0)
    old["minimize_animation"] = animation.iMinAnimate
    animation.iMinAnimate = 0
    user32.SystemParametersInfoW(0x0049, animation.cbSize, ctypes.byref(animation), 2)
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, PERSONALIZE, 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as key:
        try:
            old["transparency"] = winreg.QueryValueEx(key, "EnableTransparency")[0]
        except OSError:
            old["transparency"] = 1
        winreg.SetValueEx(key, "EnableTransparency", 0, winreg.REG_DWORD, 0)
    broadcast_theme_change()
    return old


def visual_effects_restore(old: dict) -> None:
    user32 = ctypes.WinDLL("user32")
    for name, (_, set_) in VISUAL_FLAGS.items():
        if name in old:
            user32.SystemParametersInfoW(set_, 0, ctypes.c_void_p(1 if old[name] else 0), 2)
    if "minimize_animation" in old:
        animation = ANIMATIONINFO(ctypes.sizeof(ANIMATIONINFO), old["minimize_animation"])
        user32.SystemParametersInfoW(0x0049, animation.cbSize, ctypes.byref(animation), 2)
    if "transparency" in old:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, PERSONALIZE, 0, winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key, "EnableTransparency", 0, winreg.REG_DWORD, old["transparency"])
        broadcast_theme_change()


def broadcast_theme_change() -> None:
    result = wintypes.DWORD()
    ctypes.WinDLL("user32").SendMessageTimeoutW(0xFFFF, 0x001A, 0, ctypes.c_wchar_p("ImmersiveColorSet"), 2, 2000, ctypes.byref(result))


def monitor_count() -> int:
    return ctypes.WinDLL("user32").GetSystemMetrics(80)  # SM_CMONITORS


def single_display() -> bool:
    """Show only the main screen (Win+P "PC screen only"); the extended layout is remembered by Windows."""
    if monitor_count() < 2:
        return False
    subprocess.run([os.path.join(os.environ["WINDIR"], "System32", "DisplaySwitch.exe"), "/internal"])
    return True


def extend_displays() -> None:
    subprocess.run([os.path.join(os.environ["WINDIR"], "System32", "DisplaySwitch.exe"), "/extend"])


def command_lines() -> dict[int, dict]:
    script = ("Get-CimInstance Win32_Process | Select-Object ProcessId, ExecutablePath, CommandLine | ConvertTo-Json -Compress")
    out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", script], capture_output=True, text=True)
    return {row["ProcessId"]: row for row in json.loads(out.stdout or "[]")}


def store_app_id(exe: str) -> str | None:
    """Microsoft Store apps can't be started from their WindowsApps exe; they start by app id."""
    folder = Path(exe).parts[3] if "\\windowsapps\\" in exe.lower() else None
    if not folder:
        return None
    name = folder.split("_")[0]
    script = (f"$p = Get-AppxPackage -Name '{name}' | Select-Object -First 1; "
              "if ($p) { $p.PackageFamilyName + '!' + (($p | Get-AppxPackageManifest).Package.Applications.Application | Select-Object -First 1).Id }")
    out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", script], capture_output=True, text=True)
    return out.stdout.strip() or None


def top_windows() -> dict[int, list[int]]:
    user32 = ctypes.WinDLL("user32")
    windows: dict[int, list[int]] = {}
    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def collect(hwnd, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        windows.setdefault(pid.value, []).append(hwnd)
        return True
    user32.EnumWindows(collect, 0)
    return windows


def close_apps(procs: list[dict], keep: set[int], log=print, state: dict | None = None) -> list[dict]:
    """End-session close (WM_QUERYENDSESSION + WM_ENDSESSION/ENDSESSION_CLOSEAPP) of each app tree."""
    names = {p["pid"]: p["name"] for p in procs}
    roots = [p for p in procs if p["name"] in CLOSE and names.get(p["ppid"]) != p["name"] and p["pid"] not in keep]
    if not roots:
        return []
    info = command_lines()
    closed = []
    for root in roots:
        row = info.get(root["pid"]) or {}
        exe, cmd = row.get("ExecutablePath"), row.get("CommandLine") or ""
        if not exe:
            log(f"{root['name']}: path not readable, it will be suspended instead")
            continue
        args = cmd[cmd.lower().find(".exe") + 4:].lstrip('" ') if ".exe" in cmd.lower() else ""
        entry = {"name": root["name"], "exe": exe, "args": args, "app_id": store_app_id(exe), "pid": root["pid"]}
        closed.append(entry)
        if state is not None:
            state["closed"] = closed
            save(state)  # recorded before closing, so restore can reopen it even after a crash
    user32 = ctypes.WinDLL("user32")
    windows = top_windows()
    for entry in closed:
        tree = descendants(procs, {entry["pid"]})
        hwnds = [h for pid in tree for h in windows.get(pid, [])]
        result = wintypes.DWORD()
        for hwnd in hwnds:  # ENDSESSION_CLOSEAPP = 1: "close so you can be restarted"
            user32.SendMessageTimeoutW(hwnd, 0x0011, 0, 1, 0x0002, 3000, ctypes.byref(result))
        for hwnd in hwnds:
            user32.SendMessageTimeoutW(hwnd, 0x0016, 1, 1, 0x0002, 3000, ctypes.byref(result))
    deadline = time.time() + 20
    while time.time() < deadline:
        alive = {p["pid"] for p in processes()}
        if not any(e["pid"] in alive for e in closed):
            break
        time.sleep(1)
    alive = {p["pid"] for p in processes()}
    for entry in closed:
        entry["closed"] = entry["pid"] not in alive
        log(f"{entry['name']}: {'closed' if entry['closed'] else 'did not close, it will be suspended'}")
    return closed


def reopen(entry: dict, log=print) -> None:
    """Start through Explorer so the app runs as the normal user, not as administrator."""
    explorer = os.path.join(os.environ["WINDIR"], "explorer.exe")
    if entry.get("app_id"):
        subprocess.Popen([explorer, f"shell:AppsFolder\\{entry['app_id']}"])
    else:
        launcher = STATE_FILE.parent / f"reopen-{Path(entry['exe']).stem}.cmd"
        launcher.write_text(f'@start "" "{entry["exe"]}" {entry["args"]}\r\n', encoding="utf-8")
        subprocess.Popen([explorer, str(launcher)])
    log(f"reopened {entry['name']}")


def apply(log=print, visual: bool = False, one_display: bool = False, suspend: bool = True,
          priority: bool = True, stop_services: bool = True, standby: bool = True, close: bool = False) -> dict:
    if STATE_FILE.exists():
        log("A previous tune is still applied; restoring it first.")
        restore(log)
    procs = processes()
    if close:
        state = {"suspended": [], "priority": [], "services": [], "names": {}}
        close_apps(procs, protected_pids(procs), log, state)
        procs = processes()  # what is left gets suspended / lowered as usual
        closed = state.get("closed", [])
    else:
        closed = []
    keep = protected_pids(procs)
    keep_running = descendants(procs, {p["pid"] for p in procs if p["name"] in KEEP_RUNNING_ROOTS})
    to_suspend = descendants(procs, {p["pid"] for p in procs if p["name"] in SUSPEND}) - keep - keep_running
    if not suspend:
        to_suspend = set()
    if not priority:  # only the suspended apps are touched
        keep |= {p["pid"] for p in procs} - to_suspend
    state = {"suspended": [], "priority": [], "services": running_services() if stop_services else [], "names": {},
             "closed": [e for e in closed if e.get("closed")]}
    save(state)  # services are recorded before they are stopped
    if visual:
        state["visual"] = visual_effects_off()
        save(state)
    if one_display:
        state["single_display"] = True
        save(state)  # recorded first: restoring /extend is harmless if the switch did nothing
        state["single_display"] = single_display()
        save(state)
    for proc in procs:
        pid = proc["pid"]
        if pid in keep or proc["session"] == 0:
            continue
        if pid in to_suspend:
            handle = open_process(pid, PROCESS_SUSPEND_RESUME | PROCESS_SET_QUOTA)
            if not handle:
                continue
            entry = [pid, created(handle)]
            state["suspended"].append(entry)
            save(state)  # written before suspending, so a crash can still resume it
            ntdll.NtSuspendProcess(handle)
            psapi.EmptyWorkingSet(handle)
        else:
            handle = open_process(pid, PROCESS_SET_INFORMATION)
            if not handle:
                continue
            old = kernel32.GetPriorityClass(handle)
            if old in (NORMAL, ABOVE_NORMAL):
                state["priority"].append([pid, created(handle), old])
                save(state)
                kernel32.SetPriorityClass(handle, BELOW_NORMAL)
                set_ecoqos(handle, True)
            elif old == 0:
                kernel32.CloseHandle(handle)
                continue
        state["names"][str(pid)] = proc["name"]
        kernel32.CloseHandle(handle)
    save(state)
    state["service_result"] = services("Stop", state["services"])
    state["standby"] = purge_standby_list() if standby else "not requested"
    save(state)
    log(f"Suspended {len(state['suspended'])} processes, lowered {len(state['priority'])}, "
        f"stopped services {state['service_result']}, standby list: {state['standby']}")
    return state


def restore(log=print) -> None:
    if not STATE_FILE.exists():
        log("Nothing to restore.")
        return
    state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    resumed = reset = 0
    for pid, when in state.get("suspended", []):
        handle = open_process(pid, PROCESS_SUSPEND_RESUME)
        if handle and created(handle) == when:
            ntdll.NtResumeProcess(handle)
            resumed += 1
        if handle:
            kernel32.CloseHandle(handle)
    for pid, when, old in state.get("priority", []):
        handle = open_process(pid, PROCESS_SET_INFORMATION)
        if handle and created(handle) == when:
            kernel32.SetPriorityClass(handle, old)
            set_ecoqos(handle, False)
            reset += 1
        if handle:
            kernel32.CloseHandle(handle)
    started = services("Start", state.get("services", []))
    if "visual" in state:
        visual_effects_restore(state["visual"])
    if state.get("single_display"):
        extend_displays()
    for entry in state.get("closed", []):
        reopen(entry, log)
    STATE_FILE.unlink()
    log(f"Resumed {resumed}, priority restored on {reset}, services started {started}")


class MEMORY_LISTS(ctypes.Structure):  # SYSTEM_MEMORY_LIST_INFORMATION
    _fields_ = [("zero", ctypes.c_size_t), ("free", ctypes.c_size_t), ("modified", ctypes.c_size_t),
                ("modified_no_write", ctypes.c_size_t), ("bad", ctypes.c_size_t),
                ("standby", ctypes.c_size_t * 8), ("repurposed", ctypes.c_size_t * 8), ("modified_pagefile", ctypes.c_size_t)]


def measure(seconds: int = 5) -> dict:
    """RAM split like Task Manager / RAMMap, CPU busy over `seconds`, process count."""
    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD), ("total", ctypes.c_ulonglong),
                    ("avail", ctypes.c_ulonglong)] + [(n, ctypes.c_ulonglong) for n in ("pt", "pa", "vt", "va", "ext")]
    status = MEMORYSTATUSEX()
    status.length = ctypes.sizeof(status)
    def cpu_times():
        idle, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
        kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user))
        value = lambda ft: (ft.dwHighDateTime << 32) | ft.dwLowDateTime
        return value(idle), value(kernel) + value(user)
    idle1, total1 = cpu_times()
    time.sleep(seconds)
    idle2, total2 = cpu_times()
    kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
    lists = MEMORY_LISTS()
    gb = lambda pages: round(pages * 4096 / 2**30, 2)
    result = {"cpu_busy_pct": round(100 * (1 - (idle2 - idle1) / max(1, total2 - total1)), 1),
              "ram_in_use_gb": round((status.total - status.avail) / 2**30, 2), "processes": len(processes())}
    if ntdll.NtQuerySystemInformation(80, ctypes.byref(lists), ctypes.sizeof(lists), None) == 0:
        result.update(standby_gb=gb(sum(lists.standby)), free_gb=gb(lists.free + lists.zero),
                      modified_gb=gb(lists.modified))
    return result


def demo(hold: int, log=print, close: bool = False) -> None:
    """Lighten Windows, keep it that way for `hold` seconds, put everything back, and show the numbers."""
    rows = [("before", measure())]
    log(f"before: {rows[-1][1]}")
    try:
        state = apply(log, visual=True, one_display=True, close=close)
        time.sleep(5)  # trimmed pages land on the standby list; purge again so they become free memory
        log(f"second standby purge: {purge_standby_list()}")
        rows.append(("lightened", measure()))
        log(f"lightened ({len(state['suspended'])} suspended, {len(state['priority'])} lowered): {rows[-1][1]}")
        log(f"holding {hold} s...")
        time.sleep(hold)
    finally:
        restore(log)
    time.sleep(10)
    rows.append(("restored", measure()))
    log(f"restored: {rows[-1][1]}")
    keys = list(rows[0][1])
    log("\n" + f"{'':<12}" + "".join(f"{k:>16}" for k in keys))
    for label, values in rows:
        log(f"{label:<12}" + "".join(f"{values.get(k, '-'):>16}" for k in keys))


def boost(pid: int) -> None:
    """Raise a game/benchmark to above-normal priority (never High: it starves audio and input)."""
    handle = open_process(pid, PROCESS_SET_INFORMATION)
    if handle:
        kernel32.SetPriorityClass(handle, ABOVE_NORMAL)
        set_ecoqos(handle, False)
        kernel32.CloseHandle(handle)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["apply", "restore", "status", "demo"])
    parser.add_argument("--hold", type=int, default=60, help="demo: seconds to stay lightened")
    parser.add_argument("--log", help="demo: also write the output to this file")
    parser.add_argument("--close", action="store_true", help="close apps in order and reopen them, instead of suspending them")
    parser.add_argument("--visual", action="store_true", help="also turn off animations, shadows and transparency")
    parser.add_argument("--single-display", action="store_true", help="also show only the main screen")
    args = parser.parse_args()
    if args.action == "apply":
        apply(visual=args.visual, one_display=args.single_display, close=args.close)
    elif args.action == "restore":
        restore()
    elif args.action == "demo":
        handle = open(args.log, "w", encoding="utf-8") if args.log else None
        def log(text):
            print(text, flush=True)
            if handle:
                handle.write(text + "\n")
                handle.flush()
        demo(args.hold, log, close=args.close)
    else:
        print(STATE_FILE.read_text(encoding="utf-8") if STATE_FILE.exists() else "Nothing applied.")


if __name__ == "__main__":
    if os.name != "nt":
        sys.exit("Windows only.")
    main()
