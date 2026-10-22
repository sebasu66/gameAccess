"""A/B frame-time benchmark built on Intel PresentMon.

capture  run PresentMon on a game for N seconds and save the CSV
report   print avg FPS, 1% / 0.1% lows and stutter for one or more CSVs
compare  compare two groups of runs (e.g. boost off vs on) by their medians

Only the standard library is used, so it runs with any Python 3.10+.
"""
from __future__ import annotations

import argparse
import csv
import math
import os
import shutil
import statistics
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / ".cache" / "benchmarks"
FRAME_COLUMNS = ("MsBetweenPresents", "FrameTime", "msBetweenPresents")
STUTTER_WINDOW = 30      # frames of context for the rolling median
STUTTER_FACTOR = 2.0     # a frame this many times slower than its neighbours is a stutter
STUTTER_MIN_MS = 4.0     # ...and at least this many ms slower, so 0.5 ms jitter at 500 FPS is not counted

NEGLIGIBLE_PCT = 1.0     # changes smaller than this are not worth reporting as a gain

METRICS = (  # key, column label, long label, higher is better
    ("avg_fps", "avg fps", "Avg FPS", True),
    ("low_1", "1% low", "1% low FPS", True),
    ("low_01", "0.1% low", "0.1% low FPS", True),
    ("p99_ms", "p99 ms", "P99 frame time (ms)", False),
    ("stdev_ms", "stdev ms", "Frame-time stdev (ms)", False),
    ("stutters_per_min", "stutter/min", "Stutters / min", False),
)


def find_presentmon(explicit: str | None) -> Path:
    candidates = [explicit, os.environ.get("PRESENTMON")]
    candidates += sorted(map(str, (Path(__file__).parent / "bin").glob("PresentMon*.exe")), reverse=True)
    candidates += [shutil.which(name) for name in ("PresentMon", "PresentMon-2.6.0-x64")]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    sys.exit("PresentMon not found. Download PresentMon-<version>-x64.exe from "
             "https://github.com/GameTechDev/PresentMon/releases into tools/benchmark/bin/, "
             "or pass --presentmon PATH / set PRESENTMON.")


def read_frames(path: Path) -> tuple[str, list[float]]:
    """Frame times in ms for the busiest swap chain of the file (games often own a second, idle one)."""
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError(f"{path.name}: no frames captured")
    column = next((c for c in FRAME_COLUMNS if c in rows[0]), None)
    if column is None:
        raise ValueError(f"{path.name}: none of {FRAME_COLUMNS} in the CSV header")
    chains: dict[tuple, list[float]] = {}
    for row in rows:
        try:
            value = float(row[column])
        except (TypeError, ValueError):
            continue
        if value > 0 and not math.isnan(value):
            chains.setdefault((row.get("Application"), row.get("ProcessID"), row.get("SwapChainAddress")), []).append(value)
    if not chains:
        raise ValueError(f"{path.name}: no valid frame times")
    key, frames = max(chains.items(), key=lambda item: len(item[1]))
    return key[0] or "?", frames


def low_fps(frames: list[float], share: float) -> float:
    """Average FPS of the slowest `share` of frames (the "1% low" used by most reviewers)."""
    worst = sorted(frames, reverse=True)[:max(1, math.ceil(len(frames) * share))]
    return 1000 / statistics.fmean(worst)


def stutter_count(frames: list[float]) -> int:
    count = 0
    for i in range(STUTTER_WINDOW, len(frames)):
        typical = statistics.median(frames[i - STUTTER_WINDOW:i])
        if frames[i] > typical * STUTTER_FACTOR and frames[i] - typical >= STUTTER_MIN_MS:
            count += 1
    return count


def analyze(frames: list[float]) -> dict:
    seconds = sum(frames) / 1000
    ordered = sorted(frames)
    return {
        "frames": len(frames),
        "seconds": seconds,
        "avg_fps": len(frames) / seconds,
        "low_1": low_fps(frames, 0.01),
        "low_01": low_fps(frames, 0.001),
        "p99_ms": ordered[min(len(ordered) - 1, math.ceil(len(ordered) * 0.99) - 1)],
        "stdev_ms": statistics.pstdev(frames),
        "stutters_per_min": stutter_count(frames) / seconds * 60,
    }


def load(paths: list[str]) -> list[tuple[Path, str, dict]]:
    files = [Path(p) for pattern in paths for p in (sorted(Path().glob(pattern)) if any(ch in pattern for ch in "*?[") else [Path(pattern)])]
    if not files:
        sys.exit(f"No CSV files match {paths}")
    result = []
    for path in files:
        app, frames = read_frames(path)
        result.append((path, app, analyze(frames)))
    return result


def print_runs(runs: list[tuple[Path, str, dict]]) -> None:
    print(f"{'run':<30}{'app':<20}{'sec':>5}" + "".join(f"{short:>12}" for _, short, _, _ in METRICS))
    for path, app, stats in runs:
        print(f"{path.stem[:29]:<30}{app[:19]:<20}{stats['seconds']:>5.0f}" + "".join(f"{stats[key]:>12.1f}" for key, _, _, _ in METRICS))


def cmd_capture(args) -> None:
    presentmon = find_presentmon(args.presentmon)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for run in range(1, args.runs + 1):
        if args.runs > 1 or not args.no_wait:
            input(f"[{args.label} run {run}/{args.runs}] Get the game to the start of the test scene, then press Enter... ")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output = out_dir / f"{args.label}-{stamp}-r{run}.csv"
        command = [str(presentmon), "--process_name", args.process, "--output_file", str(output),
                   "--delay", str(args.delay), "--timed", str(args.seconds), "--terminate_after_timed",
                   "--no_console_stats", "--stop_existing_session", "--session_name", "GameAccessBenchmark"]
        print(f"Capturing {args.process} for {args.seconds}s (after {args.delay}s delay)...")
        started = time.monotonic()
        completed = subprocess.run(command, capture_output=True, text=True)
        if completed.returncode != 0 or not output.is_file():
            message = (completed.stderr or completed.stdout).strip()
            hint = " Run from an administrator terminal (or join the 'Performance Log Users' group)." if "access" in message.lower() or "privilege" in message.lower() or "admin" in message.lower() else ""
            sys.exit(f"PresentMon failed (exit {completed.returncode}): {message or 'no CSV written - is the game running and rendering?'}{hint}")
        print(f"Saved {output} ({time.monotonic() - started:.0f}s)")
        print_runs(load([str(output)]))


def cmd_report(args) -> None:
    print_runs(load(args.csv))


def cmd_compare(args) -> None:
    group_a, group_b = load(args.a), load(args.b)
    print(f"A = {args.name_a} ({len(group_a)} runs)")
    print_runs(group_a)
    print(f"\nB = {args.name_b} ({len(group_b)} runs)")
    print_runs(group_b)
    print(f"\n{'metric':<24}{args.name_a[:14]:>14}{args.name_b[:14]:>14}{'change':>10}  verdict")
    for key, _, label, higher_better in METRICS:
        values_a = [stats[key] for _, _, stats in group_a]
        values_b = [stats[key] for _, _, stats in group_b]
        median_a, median_b = statistics.median(values_a), statistics.median(values_b)
        change = (median_b - median_a) / median_a * 100 if median_a else (100.0 if median_b else 0.0)
        # A result only counts when every B run beats every A run (no overlap); otherwise run-to-run noise could explain it.
        b_wins = min(values_b) > max(values_a) if higher_better else max(values_b) < min(values_a)
        a_wins = max(values_b) < min(values_a) if higher_better else min(values_b) > max(values_a)
        if len(values_a) < 2 or len(values_b) < 2:
            verdict = "need 2+ runs per side"
        elif abs(change) < NEGLIGIBLE_PCT:
            verdict = "no real change"
        elif b_wins:
            verdict = "better (runs don't overlap)"
        elif a_wins:
            verdict = "worse (runs don't overlap)"
        else:
            verdict = "inconclusive (runs overlap)"
        print(f"{label:<24}{median_a:>14.1f}{median_b:>14.1f}{change:>+9.1f}%  {verdict}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    capture = commands.add_parser("capture", help="record a game with PresentMon")
    capture.add_argument("--process", required=True, help="game executable name, e.g. Cyberpunk2077.exe")
    capture.add_argument("--seconds", type=int, default=60)
    capture.add_argument("--delay", type=int, default=3, help="seconds to wait before recording")
    capture.add_argument("--runs", type=int, default=1)
    capture.add_argument("--label", default="run", help="file name prefix, e.g. off / on")
    capture.add_argument("--out", default=str(DEFAULT_OUT))
    capture.add_argument("--presentmon")
    capture.add_argument("--no-wait", action="store_true", help="start a single run without waiting for Enter")
    capture.set_defaults(func=cmd_capture)

    report = commands.add_parser("report", help="stats for CSV files (globs allowed)")
    report.add_argument("csv", nargs="+")
    report.set_defaults(func=cmd_report)

    compare = commands.add_parser("compare", help="compare two groups of runs")
    compare.add_argument("--a", nargs="+", required=True, help="baseline CSVs, e.g. .cache/benchmarks/off-*.csv")
    compare.add_argument("--b", nargs="+", required=True, help="changed CSVs, e.g. .cache/benchmarks/on-*.csv")
    compare.add_argument("--name-a", default="A")
    compare.add_argument("--name-b", default="B")
    compare.set_defaults(func=cmd_compare)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except ValueError as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
