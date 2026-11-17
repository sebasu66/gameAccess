"""Quick A/B of the driver frame-rate cap (NVIDIA "Max frame rate") on Unigine Heaven's free-running demo.

Alternates uncapped / capped rounds; each round warms up, records 45 s with PresentMon and samples GPU
power, GPU load and CPU load. The cap is the main monitor's refresh rate minus 3 (stays inside
G-Sync/FreeSync range), written to Heaven's driver profile and always removed at the end.
Run as administrator (PresentMon and writing driver profiles need it). About 5 minutes.

  python tools/benchmark/fps_cap_test.py [--rounds 2] [--seconds 45]
"""
from __future__ import annotations

import argparse
import ctypes
import json
import statistics
import subprocess
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import frame_benchmark  # noqa: E402
import nvidia_profile  # noqa: E402
import run_ab  # noqa: E402

MAX_FRAME_RATE = 0x10835002
HEAVEN_DEMO_ARGS = [a for a in run_ab.HEAVEN_ARGS if a not in ("-extern_define", "PHORONIX,RELEASE")]
HEAVEN_DEMO_ARGS[HEAVEN_DEMO_ARGS.index("-video_width") + 1] = "1920"
HEAVEN_DEMO_ARGS[HEAVEN_DEMO_ARGS.index("-video_height") + 1] = "1080"


def main_monitor_hz() -> int:
    class DEVMODE(ctypes.Structure):
        _fields_ = [("name", ctypes.c_wchar * 32), ("v", ctypes.c_uint16 * 4), ("fields", ctypes.c_uint32),
                    ("pos", ctypes.c_long * 2), ("o", ctypes.c_uint32 * 2), ("c", ctypes.c_short * 5),
                    ("form", ctypes.c_wchar * 32), ("lp", ctypes.c_uint16), ("bpp", ctypes.c_uint32),
                    ("w", ctypes.c_uint32), ("h", ctypes.c_uint32), ("flags", ctypes.c_uint32), ("hz", ctypes.c_uint32),
                    ("pad", ctypes.c_byte * 64)]
    mode = DEVMODE()
    mode.v[2] = ctypes.sizeof(DEVMODE)  # dmSize
    ctypes.WinDLL("user32").EnumDisplaySettingsW(None, -1, ctypes.byref(mode))  # None = main monitor
    return mode.hz


def cpu_times() -> tuple[int, int]:
    from ctypes import wintypes
    idle, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
    ctypes.WinDLL("kernel32").GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user))
    value = lambda ft: (ft.dwHighDateTime << 32) | ft.dwLowDateTime
    return value(idle), value(kernel) + value(user)


def round_(out: Path, label: str, index: int, seconds: int, log) -> dict:
    heaven = subprocess.Popen([str(run_ab.HEAVEN_BIN / "Heaven.exe"), *HEAVEN_DEMO_ARGS], cwd=run_ab.HEAVEN_BIN,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(20)  # load the world and let clocks settle
        csv_path = out / f"{label}-r{index}.csv"
        presentmon = subprocess.Popen([str(frame_benchmark.find_presentmon(None)), "--process_name", "Heaven.exe",
                                       "--output_file", str(csv_path), "--timed", str(seconds), "--terminate_after_timed",
                                       "--no_console_stats", "--stop_existing_session", "--session_name", "GameAccessCap"],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        gpu = subprocess.Popen(["nvidia-smi", "--query-gpu=power.draw,utilization.gpu,clocks.gr",
                                "--format=csv,noheader,nounits", "-lms", "1000"], stdout=subprocess.PIPE, text=True)
        idle1, total1 = cpu_times()
        presentmon.wait(timeout=seconds + 30)
        idle2, total2 = cpu_times()
        gpu.terminate()
        samples = [list(map(float, line.split(","))) for line in gpu.communicate()[0].splitlines() if line.count(",") == 2]
    finally:
        heaven.kill()
        heaven.wait()
    for _ in range(20):
        try:
            csv_path.open("rb").close()
            break
        except PermissionError:
            time.sleep(1)
    _, frames = frame_benchmark.read_frames(csv_path)
    result = {"label": label, "round": index, **{k: round(v, 2) for k, v in frame_benchmark.analyze(frames).items()},
              "gpu_watts": round(statistics.fmean(s[0] for s in samples), 1) if samples else None,
              "gpu_load_pct": round(statistics.fmean(s[1] for s in samples), 1) if samples else None,
              "gpu_mhz": round(statistics.fmean(s[2] for s in samples)) if samples else None,
              "cpu_busy_pct": round(100 * (1 - (idle2 - idle1) / max(1, total2 - total1)), 1)}
    log(f"{label} round {index}: {result}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--seconds", type=int, default=45)
    args = parser.parse_args()
    out = frame_benchmark.DEFAULT_OUT / f"cap-{datetime.now():%Y%m%d-%H%M%S}"
    out.mkdir(parents=True, exist_ok=True)
    log_file = (out / "run.log").open("w", encoding="utf-8")
    def log(text):
        line = f"{datetime.now():%H:%M:%S} {text}"
        log_file.write(line + "\n")
        log_file.flush()
    cap = main_monitor_hz() - 3
    log(f"main monitor {cap + 3} Hz -> cap {cap} FPS")
    results, change = [], None
    try:
        for index in range(1, args.rounds + 1):
            results.append(round_(out, "uncapped", index, args.seconds, log))
            change = nvidia_profile.set_for_app(str(run_ab.HEAVEN_BIN / "Heaven.exe"), MAX_FRAME_RATE, cap)
            log(f"cap set in profile {change['profile']!r}")
            results.append(round_(out, "capped", index, args.seconds, log))
            nvidia_profile.restore_for_app(change)
            change = None
    except BaseException:
        log("FAILED:\n" + traceback.format_exc())
        raise
    finally:
        if change:
            nvidia_profile.restore_for_app(change)
        log("cap removed")
    (out / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    keys = ["avg_fps", "low_1", "low_01", "p99_ms", "stdev_ms", "stutters_per_min", "gpu_watts", "gpu_load_pct", "gpu_mhz", "cpu_busy_pct"]
    log("\n" + f"{'':<10}" + "".join(f"{k:>14}" for k in keys))
    for label in ("uncapped", "capped"):
        rows = [r for r in results if r["label"] == label]
        log(f"{label:<10}" + "".join(f"{statistics.median([r[k] for r in rows if r[k] is not None]):>14.1f}" for k in keys))


if __name__ == "__main__":
    main()
