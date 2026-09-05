# GameAccess Development Guardrails

This file defines mandatory development behavior for GameAccess. Read it before making code changes, running implementation experiments, or preparing local builds.

## 1. Remote-first workflow

The canonical source is the GitHub repository.

For normal development work, use this sequence only:

1. Inspect and edit the project in GitHub.
2. Commit the source changes to the remote repository.
3. In the existing working copy at `C:\DEV\gameAccess`, run `git pull --ff-only`.
4. Run tests and builds from that existing working copy.
5. Do not create temporary clones, duplicate working trees, sparse clones, or alternate copies of the repository unless the user explicitly requests one.
6. Do not use the local working copy as an independent source-editing branch when the task is being developed remotely.
7. Never force-push to reconcile a mistake.

## 2. Do not remove working behavior without an explicit request

Existing working behavior is part of the product contract unless the user explicitly asks to replace or remove it.

In particular:

- Do not remove the download-complete dialog that asks whether the user wants to play the newly downloaded game.
- Do not remove the green installed-game indicator from grid cards.
- Do not remove existing Play/Download behavior while redesigning the detail UI.
- Do not silently replace a proven Steam flow with a different mechanism.
- When refactoring UI, preserve behavior first; change presentation separately.

A redesign request is not permission to delete unrelated functionality.

## 3. UI thread must never wait for data

The UI/render thread must remain responsive independently of data loading.

Mandatory rules:

- Render immediately from already available catalog data.
- Game-detail metadata loads asynchronously only after the user navigates to/selects the specific game that needs it.
- Do not preload screenshots, movies, requirements, download size, download estimates, Steam Store metadata, or other heavy per-game details across the catalog.
- Do not fan out filesystem scans or native status probes across the whole game list just to populate detail UI.
- Native work that can block must run off the Tauri/UI command thread (`spawn_blocking` or an equivalent worker mechanism).
- Switching rapidly between games must cancel/ignore stale detail responses rather than blocking navigation.

This separation is a regression-tested architectural requirement, not an optimization suggestion.

## 4. Fetch detail lazily and cache it

When a user selects/navigates to a game:

- Load that game's extended Steam metadata asynchronously.
- Load its screenshots and Steam videos asynchronously.
- Calculate or retrieve download size/estimate only for that game.
- Probe detailed download/install state only for the selected game and for downloads that are already actively being tracked.
- Cache every reusable result by AppID/game ID so revisiting the game does not repeat expensive work.
- Use persistent native/backend caches where appropriate and an in-memory request/result cache in the UI to deduplicate concurrent requests.

The catalog itself should receive only the lightweight information needed to render and navigate it.

## 5. Download UX contract

For a download managed by GameAccess:

- Show live progress when available.
- Show downloaded bytes, total bytes, speed, and ETA when known.
- Never fabricate progress, size, speed, or ETA.
- `preparing` is a valid in-progress state and must not trigger fallback merely because byte progress has not started yet.
- When a tracked download transitions to `installed`, update the grid immediately.
- A newly installed game must show the same green installed badge as a game that was already installed when GameAccess started.
- A completed tracked download must raise the download-complete dialog exactly once for that completion and offer **Play now** / **Not now**.
- Detection of installation must not depend on license availability; installed state and current account/copy availability are separate concepts.

## 6. Detail and library UI contract

The main library is the primary game-browsing surface.

- Give the games grid substantial screen space.
- Keep its scrollbar visible and usable.
- The selected game's detail is one continuous scrollable document, not a smaller legacy detail view with another "More information" screen stacked beneath it.
- Reuse one Play action and one Download action; do not duplicate competing controls.
- Steam videos are valid hero/detail media and should be used when returned for the selected game.
- Thumbs-up/down preferences are persistent.
- Sorting priority: installed or liked games first, neutral games next, disliked games last; preserve stable ordering inside equivalent groups where practical.

## 7. Steam safety and login rules

- Never automate Steam login by clicking UI/login-form controls.
- Provider login must use the approved SteamKit/Steam CLI mechanisms already implemented by the project.
- Before initiating a real Steam login, account switch, download, or launch test on the user's PC, explicitly warn the user so they can stop personal Steam activity.
- Inspection, source edits, tests, compilation, and build staging must not launch Steam.

## 8. Local working-copy safety

`C:\DEV\gameAccess` is the established build/test checkout.

- Preserve dirty/untracked user work.
- Never reset, clean, or discard files merely to obtain a clean tree.
- Generated EXEs, build targets, logs, debug output, scanner binaries, and other generated artifacts are not source changes and must not be committed.
- Pull with `--ff-only`; if it cannot fast-forward, stop and diagnose instead of improvising another repository copy.

## 9. Regression discipline

When fixing a regression, add or update tests so the removed behavior cannot regress silently again.

High-priority permanent regression contracts include:

- UI thread isolation from blocking data/native operations.
- No catalog-wide heavy detail prefetch.
- selected-game-only async detail loading with stale-response protection.
- Steam video selection for the selected game.
- persistent installed badges, including newly completed downloads.
- download-complete Play Now dialog.
- existing Steam login/download routing must survive unrelated UI refactors.

## 10. Avoid unnecessary complexity

Before inventing infrastructure, clones, adapters, replacement workflows, or compatibility layers, use the simplest existing project path that satisfies the request.

If the repository is already present at `C:\DEV\gameAccess`, do not clone it again just to build it. If GitHub can edit the remote source directly, do not manufacture a temporary source tree merely to make the same edit.

Do not solve a local implementation problem by creating a larger workflow problem.
