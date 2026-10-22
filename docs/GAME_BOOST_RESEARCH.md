# Game Boost (game mode) — research

Research done 2026-10-22. Goal: when a game starts from Game Access, temporarily make Windows favour it (fewer background processes competing for CPU, RAM and disk), then undo everything when the game exits. Nothing is implemented yet.

## Short answer

- On a modern PC with 16 GB+ RAM the FPS gain from "boosters" is small and often within the margin of error. The real gains are in **1% lows / stutter** on weak or cluttered PCs (8 GB RAM, 4 cores, laptops, many tray apps, a browser with 40 tabs, an active download).
- Every serious tool converges on the same safe recipe: **lower background priority + EcoQoS, switch the power plan, restore on exit**. Suspending or killing processes is the part that breaks things and the one Bitsum (Process Lasso) explicitly advises against.
- Game Access has a uniquely useful lever nobody else has: **its own download queue and torrent client**, which is often the heaviest background load on the user's PC. Pausing that during play is the cheapest real win.

## What existing tools do

| Tool | License | What it actually does | Notes |
|---|---|---|---|
| Windows Game Mode (built in) | — | Gives the foreground game scheduler preference, suppresses Windows Update driver installs and restart prompts during play | On by default since Windows 10 1809. Microsoft itself only promises "less FPS variability depending on the game and system". Nothing to replicate, just don't fight it. |
| Process Lasso / ProBalance (Bitsum) | Proprietary | Dynamically lowers priority of background processes that hog CPU; "Gaming Mode" excludes the game from ProBalance and switches to a "Bitsum Highest Performance" power plan | Developer: not magic, don't expect big FPS gains. Recommends CPU affinity limits over suspending. |
| Razer Cortex Game Booster | Proprietary | Closes/stops non-essential apps and services, disables CPU core parking ("CPU sleep mode"), frees RAM | No independent benchmark found; user reports mixed. Helps mostly on low-RAM systems. |
| GameBoostHD (r1ch.net) | Freeware, source not published | On detecting a known game: lowers priority of launchers/browsers, marks them **EcoQoS**, switches to High Performance plan (restores it), sets Wi-Fi adapter to media-streaming mode and disables background Wi-Fi scanning | 4 KiB C program. Closest to what we want; the Wi-Fi scan tweak is a real fix for periodic ping spikes. |
| SceneShift (tandukuda/SceneShift, GitHub) | Open source (check license) | User-defined "scenes": suspend/resume processes via `NtSuspendProcess`/`NtResumeProcess`, with a safelist of critical system processes | Shows the suspend approach; browsers survive suspension without losing tabs. |
| StandbyAndTimer (layellie, GitHub) | MIT | 0.5 ms timer resolution lock, standby-list purge, High priority + full affinity for chosen games | Timer resolution and standby purge are folklore-heavy; measurable only in specific games. |
| KOALA Gaming Optimizer (GitHub) | MIT | PowerShell script of many tweaks (priority, high-precision timer, network) | Permanent system tweaks — not our model. |
| Feral GameMode (Linux) | BSD-3 | Daemon: game requests a mode, daemon applies governor/niceness/core pinning, reverts when the game exits | **Best design reference**: request → apply → refcount → guaranteed revert. |

## Techniques, ranked by value / risk

### Safe — do these (all reversible, no admin needed unless noted)

1. **Pause Game Access's own work during play.** Download queue (`download_queue::suspend()` already exists), torrent seeding, catalog refresh, auto-freeze, plugin polling. Resume on exit. Zero risk, often the biggest win for our users.
2. **Lower priority of known background hogs** to `BELOW_NORMAL_PRIORITY_CLASS` (or `IDLE`) with `SetPriorityClass`, and **opt them into EcoQoS** with `SetProcessInformation(ProcessPowerThrottling, PROCESS_POWER_THROTTLING_EXECUTION_SPEED)`. On hybrid CPUs (Intel 12th gen+) EcoQoS steers them to E-cores, leaving P-cores for the game. Targets: browsers, other launchers (Epic, Battle.net, EA, Ubisoft, GOG Galaxy, Steam client when the game isn't Steam), OneDrive/Dropbox/Google Drive sync, Windows Search indexer (`SearchIndexer.exe`, needs admin), updaters. Save the previous values and restore them exactly.
3. **Raise the game to `ABOVE_NORMAL_PRIORITY_CLASS`** (never `HIGH`/`REALTIME`: starves audio, input and the game's own helper threads; Bitsum and many forum threads report stutter from High).
4. **Power plan**: if the active plan is Balanced / Power saver, switch to High Performance (or Ultimate if present) with `PowerSetActiveScheme`, restore on exit. Skip on battery unless the user opts in. On Windows 11 also consider the power-mode overlay (`PowerSetActiveOverlayScheme`, "Best performance").
5. **Keep the game window's timer resolution honoured**: Windows 11 ignores timer requests from hidden windows; nothing to do for the game itself, but do *not* mark the game EcoQoS by accident (the helper must skip the game's whole process tree).

### Medium — opt-in, per user choice

6. **Suspend selected apps** (`NtSuspendProcess` / `NtResumeProcess`, undocumented but stable since XP; Microsoft now points to `NtCreateProcessStateChange`). Good for browsers and sync clients the user chooses. Risks: a suspended process that holds a lock or a network session can hang or drop; if Game Access crashes, they stay frozen → must persist a "suspended PIDs" file and resume on next start. Never default-on.
7. **Close apps** the user lists (graceful `WM_CLOSE`, never `TerminateProcess`). Same as Razer, but only what the user picked.
8. **Free memory**: `EmptyWorkingSet` on background processes, or standby-list purge (`NtSetSystemInformation(SystemMemoryListInformation)`, needs admin + `SeProfileSingleProcessPrivilege`). Only meaningful with ≤8 GB RAM; on larger systems it can make things worse (pages fault back in). Offer only when RAM is low.
9. **Wi-Fi background scan off** while playing (GameBoostHD) — fixes periodic ping spikes on Wi-Fi; needs WLAN API (`WlanSetInterface` `wlan_intf_opcode_background_scan_enabled`, `wlan_intf_opcode_media_streaming_mode`). Reverted automatically when the handle closes.

### Avoid

- Stopping Windows services (Defender, Update, Print Spooler, etc.) — security and support risk; Game Mode already defers updates.
- Touching anything in the game's process tree, anti-cheat processes (EAC, BattlEye, Vanguard `vgc`, ACE/SGuard), audio (`audiodg`), `dwm`, `csrss`, input/overlay helpers (Discord, Steam overlay, NVIDIA/AMD overlays). Suspending anti-cheat is a ban risk; no publisher documents what is safe.
- CPU affinity changes on the game, core-parking registry edits, permanent registry "tweaks", RAM-cleaner loops. Folklore with no reliable measured gain, and some cause regressions.
- `REALTIME`/`HIGH` priority for the game.

## How it would fit Game Access

The game is started in `apps/launcher/digital_process_runner.py` (~line 199–224), which already gets the game's PID (both normal `Popen` and the UAC path via `launch_as_administrator`). That is the hook point.

Proposed module `apps/launcher/game_boost/` (Python + ctypes, like `launch.py`), or a Rust module in `src-tauri` if it should outlive the runner:

```
boost = GameBoost(settings)           # what the user enabled
session = boost.start(game_pid)       # snapshot + apply; writes .cache/game_boost/session.json
... wait for the game tree to exit ...
session.restore()                     # restore priorities, EcoQoS, power plan, resume suspended, resume downloads
```

Design rules (borrowed from Feral GameMode):

- **Snapshot before change, restore exactly.** Store original priority class, power-throttling state and power scheme per changed process (key: PID + process creation time, so a recycled PID isn't touched).
- **Crash safety.** The session file is written before applying; on Game Access start, if a session file exists and the game is gone, restore it.
- **Game process tree.** Many games start a launcher stub that spawns the real exe and exits. Track the tree (Job Object or polling children) and treat "game running" as "any process of the tree or the foreground window belongs to the game folder".
- **Rule list, not hard-coding.** A JSON list of target executables with an action each (`lower`, `eco`, `suspend`, `close`) and a protected list that is never touched. Ship a default list; user can edit in Settings.
- **Refresh while playing.** Re-apply every ~30 s to processes started after launch (browser opened mid-game).
- **No admin by default.** Priority/EcoQoS on the user's own processes and the power scheme work unelevated. Admin-only items (indexer, standby purge) are optional.

UI (follow `docs/GUI_DESIGN.md`): a "Game Boost" toggle in Settings > Games (off / safe / custom), per-game override in the game detail, and a small toast on launch ("Boost on: 6 apps lowered, downloads paused") with restore on exit.

## How to prove it works

Measure, don't claim. Use PresentMon (Intel, open source) or CapFrameX to capture avg FPS, **1% lows** and frame-time variance on the same scene, 3+ runs each, boost off vs on, with a realistic background (browser, Discord, Game Access downloading). Only advertise what the numbers show; the honest pitch is "smoother, fewer stutters while Game Access downloads", not "+30 FPS".

## Sources

- Microsoft, `SetProcessInformation` and power throttling / EcoQoS: https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation
- Microsoft devblog, Introducing EcoQoS: https://devblogs.microsoft.com/performance-diagnostics/introducing-ecoqos/
- Xbox Wire, Game Mode behaviour (Oct 2018): https://news.xbox.com/en-us/2018/10/02/latest-october-2018-windows-update-gaming-features-3/
- Bitsum forum, Gaming Mode and ProBalance: https://community.bitsum.com/forum/index.php?msg=4534 , https://community.bitsum.com/forum/index.php?msg=29256 , on suspending: https://community.bitsum.com/forum/index.php?msg=23641
- GameBoostHD: https://r1ch.net/projects/gameboosthd
- SceneShift 2.1.0: https://newreleases.io/project/github/tandukuda/SceneShift/release/v2.1.0
- StandbyAndTimer: https://awesome.ecosyste.ms/projects/github.com%2Flayellie%2Fstandbyandtimer
- KOALA Gaming Optimizer: https://awesome.ecosyste.ms/projects/github.com%2Fkoalaaufpillen%2Fkoalaoptimizer
- Feral GameMode: https://github.com/FeralInteractive/gamemode
- Razer Cortex Game Booster: https://www.razer.com/cortex/booster
- NtSuspendProcess: https://ntdoc.m417z.com/ntsuspendprocess
