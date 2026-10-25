"""Cyberpunk 2077 (DirectX 12) built-in benchmark, unattended: FPS-cap test and lighten-Windows test.

The game starts straight into its benchmark with `--launcher-skip -benchmark -skipStartScreen`
(same flags as the Phoronix test profile), quits by itself and writes
Documents/CD Projekt Red/Cyberpunk 2077/benchmarkResults/<time>/summary.json + frames.csv
(frame times of the measured part only). GPU power/load and CPU load are sampled every second and
kept for the benchmark window only.

  python tools/benchmark/cyberpunk_test.py cap      # no cap / NVIDIA driver cap (Hz - 3) / in-game cap, x2
  python tools/benchmark/cyberpunk_test.py lighten  # normal / Windows lightened (apps closed), x2
  python tools/benchmark/cyberpunk_test.py lighten --keep-settings  # same, with the in-game FPS limit left on

Run as administrator (driver profile and services need it). The game and Steam are started through
Explorer so they run as the normal user. UserSettings.json is backed up and restored byte for byte.
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import shutil
import statistics
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import frame_benchmark  # noqa: E402
import fps_cap_test  # noqa: E402
import nvidia_profile  # noqa: E402
import system_tune  # noqa: E402

GAME_DIR = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077\bin\x64")
GAME_EXE = GAME_DIR / "Cyberpunk2077.exe"
SETTINGS = Path(os.environ["LOCALAPPDATA"]) / "CD Projekt Red" / "Cyberpunk 2077" / "UserSettings.json"
RESULTS = Path.home() / "Documents" / "CD Projekt Red" / "Cyberpunk 2077" / "benchmarkResults"
MAX_FRAME_RATE = 0x10835002


def as_user(command: str, name: str) -> None:
    """Start through Explorer: the process gets the normal user's token even if we are elevated."""
    launcher = frame_benchmark.DEFAULT_OUT / f"launch-{name}.cmd"
    launcher.write_text(f"@{command}\r\n", encoding="utf-8")
    subprocess.Popen([os.path.join(os.environ["WINDIR"], "explorer.exe"), win(launcher)])


def win(path: Path) -> str:
    """Backslash path: this Python (MSYS build) prints '/', which cmd's start rejects."""
    return str(path).replace("/", "\\")


def running(name: str) -> bool:
    return any(p["name"] == name.lower() for p in system_tune.processes())


def set_ingame_cap(on: bool) -> None:
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    for group in data.get("data", []):
        for option in group.get("options", []):
            if option.get("name") == "MaximumFPS_OnOff":
                option["value"] = on
    SETTINGS.write_text(json.dumps(data, indent=4), encoding="utf-8")


class Sampler(threading.Thread):
    """GPU power/load (nvidia-smi) and CPU busy, once per second, with timestamps."""
    def __init__(self):
        super().__init__(daemon=True)
        self.samples: list[tuple[float, float, float, float]] = []
        self.stop = threading.Event()

    def run(self):
        idle0, total0 = fps_cap_test.cpu_times()
        while not self.stop.is_set():
            out = subprocess.run(["nvidia-smi", "--query-gpu=power.draw,utilization.gpu", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True).stdout.strip()
            idle1, total1 = fps_cap_test.cpu_times()
            cpu = 100 * (1 - (idle1 - idle0) / max(1, total1 - total0))
            idle0, total0 = idle1, total1
            try:
                watts, load = map(float, out.split(","))
                self.samples.append((time.time(), watts, load, cpu))
            except ValueError:
                pass
            time.sleep(1)


def frames_of(folder: Path) -> list[float]:
    lines = (folder / "frames.csv").read_text(encoding="utf-8").splitlines()[1:]
    return [float(line.split(",")[1]) for line in lines if line.count(",") >= 1 and line.split(",")[1].strip()]


def run_once(label: str, index: int, log) -> dict:
    started = time.time()  # the exe runs without Steam (checked by Seba)
    sampler = Sampler()
    sampler.start()
    as_user(f'start "" /d "{win(GAME_DIR)}" "{win(GAME_EXE)}" --launcher-skip -benchmark -skipStartScreen', "cyberpunk")
    deadline = time.time() + 180
    while not running("Cyberpunk2077.exe"):
        if time.time() > deadline:
            raise RuntimeError("Cyberpunk did not start")
        time.sleep(2)
    deadline = time.time() + 600
    while running("Cyberpunk2077.exe"):
        if time.time() > deadline:
            raise RuntimeError("Cyberpunk did not finish the benchmark in 10 minutes")
        time.sleep(2)
    sampler.stop.set()
    sampler.join()
    folders = sorted((p for p in RESULTS.glob("benchmark_*") if p.stat().st_mtime >= started), key=lambda p: p.stat().st_mtime)
    if not folders:
        raise RuntimeError("no benchmark result written")
    summary = json.loads((folders[-1] / "summary.json").read_text(encoding="utf-8"))["Data"]
    frames = frames_of(folders[-1])
    end = (folders[-1] / "frames.csv").stat().st_mtime
    window = [s for s in sampler.samples if end - summary["time"] <= s[0] <= end]
    stats = frame_benchmark.analyze(frames)
    result = {"label": label, "round": index, "game_avg_fps": round(summary["averageFps"], 1),
              "game_min_fps": round(summary["minFps"], 1), **{k: round(v, 2) for k, v in stats.items()},
              "gpu_watts": round(statistics.fmean(s[1] for s in window), 1) if window else None,
              "gpu_load_pct": round(statistics.fmean(s[2] for s in window), 1) if window else None,
              "cpu_busy_pct": round(statistics.fmean(s[3] for s in window), 1) if window else None,
              "result_folder": folders[-1].name, "resolution": f"{summary.get('renderWidth')}x{summary.get('renderHeight')}"}
    log(f"{label} round {index}: {result}")
    time.sleep(15)
    return result


def table(results: list[dict], labels: list[str], log) -> None:
    keys = ["game_avg_fps", "game_min_fps", "low_1", "low_01", "p99_ms", "stdev_ms", "stutters_per_min", "gpu_watts", "gpu_load_pct", "cpu_busy_pct"]
    log("\n" + f"{'':<12}" + "".join(f"{k:>17}" for k in keys))
    for label in labels:
        rows = [r for r in results if r["label"] == label]
        log(f"{label:<12}" + "".join(f"{statistics.median([r[k] for r in rows if r.get(k) is not None] or [float('nan')]):>17.1f}" for k in keys))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("test", choices=["cap", "lighten"])
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--keep-settings", action="store_true",
                        help="lighten: play with the user's own settings, in-game FPS limit included")
    parser.add_argument("--lightened-only", action="store_true", help="lighten: skip the normal runs (baseline run by hand)")
    args = parser.parse_args()
    out = frame_benchmark.DEFAULT_OUT / f"cyberpunk-{args.test}-{datetime.now():%Y%m%d-%H%M%S}"
    out.mkdir(parents=True, exist_ok=True)
    log_file = (out / "run.log").open("w", encoding="utf-8")
    def log(text):
        log_file.write(f"{datetime.now():%H:%M:%S} {text}\n")
        log_file.flush()
    backup = out / "UserSettings.backup.json"
    shutil.copy2(SETTINGS, backup)
    results, change = [], None
    try:
        if args.test == "cap":
            cap = fps_cap_test.main_monitor_hz() - 3
            labels = ["no_cap", f"driver_{cap}", "ingame_60"]
            for index in range(1, args.rounds + 1):
                set_ingame_cap(False)
                results.append(run_once(labels[0], index, log))
                change = nvidia_profile.set_for_app(str(GAME_EXE), MAX_FRAME_RATE, cap)
                log(f"driver cap {cap} in profile {change['profile']!r}")
                results.append(run_once(labels[1], index, log))
                nvidia_profile.restore_for_app(change)
                change = None
                shutil.copy2(backup, SETTINGS)  # the user's own settings: in-game limiter at 60
                results.append(run_once(labels[2], index, log))
        else:
            labels = ["normal", "lightened"]
            if not args.keep_settings:
                set_ingame_cap(False)
            for index in range(1, args.rounds + 1):
                if not args.lightened_only:
                    results.append(run_once("normal", index, log))
                try:
                    # one_display stays off: switching to one screen made the game fall back from 4K to
                    # the 1024x768 stored in UserSettings.json, so the run measured something else.
                    state = system_tune.apply(log, visual=True, one_display=False, close=True)
                    log(f"lightened: {len(state.get('closed', []))} closed, {len(state['suspended'])} suspended, {len(state['priority'])} lowered")
                    time.sleep(10)
                    results.append(run_once("lightened", index, log))
                finally:
                    system_tune.restore(log)
                time.sleep(20)
    except BaseException:
        log("FAILED:\n" + traceback.format_exc())
        raise
    finally:
        if change:
            nvidia_profile.restore_for_app(change)
        shutil.copy2(backup, SETTINGS)
        log("settings restored")
        (out / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    table(results, labels, log)


if __name__ == "__main__":
    main()
