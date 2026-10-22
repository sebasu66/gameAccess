# Frame-time A/B benchmark

`frame_benchmark.py` measures a game with Intel [PresentMon](https://github.com/GameTechDev/PresentMon) and compares two setups, for example Game Boost off vs on, or this Windows install vs a clean one. Standard library only.

## Setup

Download `PresentMon-<version>-x64.exe` (about 1 MB, MIT license) from the [PresentMon releases](https://github.com/GameTechDev/PresentMon/releases) into `tools/benchmark/bin/` (git-ignored), or pass `--presentmon PATH`. Tested with PresentMon 2.6.0 (Intel-signed). Recording needs administrator rights: from a normal terminal the script adds `--restart_as_admin`, so each run shows one UAC prompt; from an administrator terminal there is no prompt.

## Use

```bash
# 3 runs with the PC as it is; press Enter at the start of the test scene each time
python tools/benchmark/frame_benchmark.py capture --process Game.exe --seconds 60 --runs 3 --label off

# change one thing (close apps, enable Game Boost...), then 3 more runs
python tools/benchmark/frame_benchmark.py capture --process Game.exe --seconds 60 --runs 3 --label on

python tools/benchmark/frame_benchmark.py compare --a ".cache/benchmarks/off-*.csv" --b ".cache/benchmarks/on-*.csv" --name-a off --name-b on
```

`report FILE...` prints the numbers for any PresentMon CSV, including ones recorded by CapFrameX or another PC.

## What the numbers mean

| Metric | Meaning |
|---|---|
| avg fps | frames / seconds. Background apps rarely move it much. |
| 1% low, 0.1% low | average FPS of the slowest 1% / 0.1% of frames. This is what "feels smoother". |
| p99 ms | 99th percentile frame time. |
| stdev ms | frame-time variation. |
| stutter/min | frames at least 2x and 4 ms slower than the median of the previous 30 frames. |

`compare` uses the median of each side. A metric is called **better/worse only when no run of one side overlaps the other**; otherwise it says *inconclusive*, because run-to-run noise could explain it. Changes under 1% are *no real change*.

## Unattended A/B with a real benchmark (`run_ab.py`)

Needs Unigine Heaven 4.0 and Superposition 1.1 installed in their default folders (free, assets.unigine.com) and an administrator Python. It runs both benchmarks 3 times with the PC as it is, applies every tweak of `system_tune.py`, runs them again, always restores, and writes `run.log`, `results.json`, `summary.txt` and the PresentMon CSVs to `.cache/benchmarks/ab-<time>/`. `--smoke` only applies, waits 10 s and restores. Takes about 55 minutes; don't use the PC meanwhile.

`system_tune.py apply [--visual] [--single-display]` / `restore` / `status` is the Game Boost prototype: suspend background apps, below-normal + EcoQoS for the rest, stop non-essential services, purge the standby list, optionally turn off visual effects and secondary screens. The previous state is saved to `.cache/benchmarks/tune-state.json` before each change, so `restore` also works after a crash. Results so far: `docs/GAME_BOOST_RESEARCH.md`.

## Getting trustworthy results

- Same scene, same settings, same resolution; a built-in benchmark is best. Do at least 3 runs per side.
- Change one thing between A and B.
- Use low resolution and high settings if you want to see CPU and background effects; at 4K the GPU hides them.
- Let the game warm up (shader compilation) before the first run, and keep the PC on the same power plan and temperature.
