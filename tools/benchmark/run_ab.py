"""Unattended A/B run: Unigine Heaven 4.0 and Superposition 1.1, PC as it is vs with every tweak.

Phase A runs both benchmarks N times with the system untouched. Phase B applies system_tune
(suspend apps, priority + EcoQoS, stop services, purge standby list, visual effects off, main
screen only), raises the benchmark to above-normal, runs again and ALWAYS restores at the end.
PresentMon records every run for 1% / 0.1% lows. Run it as administrator.

  python tools/benchmark/run_ab.py --runs 3
  python tools/benchmark/run_ab.py --smoke     # apply, wait 10 s, restore; no benchmarks
"""
from __future__ import annotations

import argparse
import contextlib
import ctypes
import io
import json
import re
import signal
import statistics
import subprocess
import sys
import time
import traceback
from ctypes import wintypes
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import frame_benchmark  # noqa: E402
import system_tune  # noqa: E402

HEAVEN_BIN = Path(r"C:\Program Files (x86)\Unigine\Heaven Benchmark 4.0\bin")
SUPER_BIN = Path(r"C:\Program Files\Unigine\Superposition Benchmark\bin")
SUPER_LOGS = Path.home() / "Superposition" / "automation"
WIDTH, HEIGHT = "1280", "720"  # low resolution so the CPU, where background load lands, is the limit

HEAVEN_ARGS = ["-data_path", "../", "-sound_app", "null", "-engine_config", "../data/heaven_4.0.cfg",
               "-system_script", "heaven/unigine.cpp", "-video_app", "direct3d11", "-video_mode", "-1",
               "-video_width", WIDTH, "-video_height", HEIGHT, "-video_fullscreen", "0",
               "-extern_define", "PHORONIX,RELEASE"]
SUPER_ARGS = ["-sound_app", "openal", "-system_script", "superposition/system_script.cpp", "-data_path", "../",
              "-engine_config", "../data/superposition/unigine.cfg", "-video_mode", "-1",
              "-project_name", "Superposition", "-video_resizable", "1",
              "-console_command", "config_readonly 1 && world_load superposition/superposition",
              "-mode", "2", "-preset", "0", "-video_width", WIDTH, "-video_height", HEIGHT,
              "-video_fullscreen", "0", "-shaders_quality", "0", "-textures_quality", "0"]


class Run:
    def __init__(self, out: Path):
        self.out = out
        self.log_file = (out / "run.log").open("a", encoding="utf-8")
        self.results: list[dict] = []

    def log(self, text: str) -> None:
        line = f"{datetime.now():%H:%M:%S} {text}"
        with contextlib.suppress(OSError, ValueError):  # the elevated console may be closed
            print(line, flush=True)
        self.log_file.write(line + "\n")
        self.log_file.flush()

    def save(self) -> None:
        (self.out / "results.json").write_text(json.dumps(self.results, indent=1), encoding="utf-8")


def system_snapshot(seconds: int = 10) -> dict:
    kernel32 = ctypes.WinDLL("kernel32")
    def times():
        idle, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
        kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user))
        value = lambda ft: (ft.dwHighDateTime << 32) | ft.dwLowDateTime
        return value(idle), value(kernel) + value(user)
    idle1, total1 = times()
    time.sleep(seconds)
    idle2, total2 = times()

    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [("dwLength", wintypes.DWORD), ("dwMemoryLoad", wintypes.DWORD)] + \
                   [(n, ctypes.c_ulonglong) for n in ("total", "avail", "pagetotal", "pageavail", "virtual", "virtualavail", "ext")]
    memory = MEMORYSTATUSEX()
    memory.dwLength = ctypes.sizeof(memory)
    kernel32.GlobalMemoryStatusEx(ctypes.byref(memory))
    return {"idle_cpu_pct": round(100 * (1 - (idle2 - idle1) / max(1, total2 - total1)), 1),
            "ram_used_gb": round((memory.total - memory.avail) / 2**30, 1),
            "processes": len(system_tune.processes()), "monitors": system_tune.monitor_count()}


def stop_presentmon(presentmon: subprocess.Popen) -> None:
    """--terminate_on_proc_exit is not always honoured; Ctrl+Break lets it flush the CSV, kill is the last resort."""
    with contextlib.suppress(subprocess.TimeoutExpired):
        presentmon.wait(timeout=10)
        return
    with contextlib.suppress(OSError):
        presentmon.send_signal(signal.CTRL_BREAK_EVENT)
    with contextlib.suppress(subprocess.TimeoutExpired):
        presentmon.wait(timeout=15)
        return
    presentmon.kill()
    presentmon.wait()


def run_benchmark(run: Run, name: str, phase: str, index: int, boost: bool) -> dict:
    exe, workdir, args = ((HEAVEN_BIN / "Heaven.exe", HEAVEN_BIN, HEAVEN_ARGS) if name == "heaven"
                          else (SUPER_BIN / "superposition.exe", SUPER_BIN, SUPER_ARGS))
    csv_path = run.out / f"{name}-{phase}-r{index}.csv"
    stdout_path = run.out / f"{name}-{phase}-r{index}.txt"
    presentmon = subprocess.Popen([str(frame_benchmark.find_presentmon(None)), "--process_name", exe.name,
                                   "--output_file", str(csv_path), "--terminate_on_proc_exit", "--no_console_stats",
                                   "--stop_existing_session", "--session_name", "GameAccessAB"],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)  # so Ctrl+Break reaches only it
    time.sleep(2)
    started = time.time()
    with stdout_path.open("w", encoding="utf-8", errors="replace") as stdout:
        bench = subprocess.Popen([str(exe), *args], cwd=workdir, stdout=stdout, stderr=subprocess.STDOUT)
        if boost:
            time.sleep(1)
            system_tune.boost(bench.pid)
        bench.wait(timeout=900)
    stop_presentmon(presentmon)
    result ={"bench": name, "phase": phase, "run": index, "seconds": round(time.time() - started)}
    if name == "heaven":
        text = stdout_path.read_text(encoding="utf-8", errors="replace")
        match = re.search(r"FPS:\s*([\d.]+)", text.split("Phoronix finished")[-1])
        result["fps"] = float(match.group(1)) if match else None
    else:
        logs = sorted((p for p in SUPER_LOGS.glob("log-*.txt") if p.stat().st_mtime >= started - 1), key=lambda p: p.stat().st_mtime)
        text = logs[-1].read_text(encoding="utf-8", errors="replace") if logs else ""
        for key, pattern in (("fps", r"^FPS:\s*([\d.]+)"), ("min_fps", r"^Min FPS:\s*([\d.]+)"),
                             ("max_fps", r"^Max FPS:\s*([\d.]+)"), ("score", r"^Score:\s*([\d.]+)")):
            match = re.search(pattern, text, re.M)
            result[key] = float(match.group(1)) if match else None
    for _ in range(20):  # the CSV can stay locked for a moment after PresentMon exits
        try:
            csv_path.open("rb").close()
            break
        except PermissionError:
            time.sleep(1)
    if csv_path.is_file():
        try:
            _, frames = frame_benchmark.read_frames(csv_path)
            result["presentmon"] = {k: round(v, 2) for k, v in frame_benchmark.analyze(frames).items()}
        except (ValueError, OSError) as error:
            result["presentmon_error"] = str(error)
    run.log(f"{name} {phase} run {index}: own FPS {result.get('fps')}, "
            f"PresentMon 1% low {result.get('presentmon', {}).get('low_1')}, {result['seconds']}s")
    return result


def phase(run: Run, label: str, runs: int, boost: bool) -> None:
    snapshot = system_snapshot()
    run.log(f"Phase {label}: system {snapshot}")
    run.results.append({"phase": label, "snapshot": snapshot})
    for name in ("heaven", "superposition"):
        for index in range(1, runs + 1):
            run.results.append(run_benchmark(run, name, label, index, boost))
            run.save()
            time.sleep(10)


def summary(run: Run) -> str:
    lines = []
    rows = [r for r in run.results if "bench" in r]
    for name in ("heaven", "superposition"):
        lines.append(f"\n=== {name}: benchmark's own result (median of runs)")
        for key in ("fps", "min_fps", "score"):
            a = [r[key] for r in rows if r["bench"] == name and r["phase"] == "normal" and r.get(key)]
            b = [r[key] for r in rows if r["bench"] == name and r["phase"] == "tuned" and r.get(key)]
            if a and b:
                ma, mb = statistics.median(a), statistics.median(b)
                lines.append(f"{key:<10} normal {ma:>9.1f}   tuned {mb:>9.1f}   {(mb - ma) / ma * 100:+.1f}%   runs A={a} B={b}")
        csv_a = [str(p) for p in sorted(run.out.glob(f"{name}-normal-r*.csv"))]
        csv_b = [str(p) for p in sorted(run.out.glob(f"{name}-tuned-r*.csv"))]
        if csv_a and csv_b:
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                frame_benchmark.main(["compare", "--a", *csv_a, "--b", *csv_b, "--name-a", "normal", "--name-b", "tuned"])
            lines.append(f"--- {name}: PresentMon frame times")
            text = buffer.getvalue()
            lines.append(text[text.find("\nmetric") + 1:] if "\nmetric" in text else text)  # the verdict table only
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    out = frame_benchmark.DEFAULT_OUT / f"ab-{datetime.now():%Y%m%d-%H%M%S}{'-smoke' if args.smoke else ''}"
    out.mkdir(parents=True, exist_ok=True)
    run = Run(out)
    run.log(f"Admin: {frame_benchmark.is_admin()}  output: {out}")
    if args.smoke:
        try:
            state = system_tune.apply(run.log, visual=True, one_display=True)
            run.log(f"Applied: {len(state['suspended'])} suspended, {len(state['priority'])} lowered, monitors now {system_tune.monitor_count()}")
            time.sleep(10)
        finally:
            system_tune.restore(run.log)
            time.sleep(3)
            run.log(f"Restored; monitors now {system_tune.monitor_count()}")
        return
    try:
        phase(run, "normal", args.runs, boost=False)
        try:
            system_tune.apply(run.log, visual=True, one_display=True)
            time.sleep(20)  # let the system settle after services stop and memory is purged
            phase(run, "tuned", args.runs, boost=True)
        finally:
            system_tune.restore(run.log)
    except BaseException:
        run.log("FAILED:\n" + traceback.format_exc())
        raise
    text = summary(run)
    (out / "summary.txt").write_text(text, encoding="utf-8")
    run.log(text)


if __name__ == "__main__":
    main()
