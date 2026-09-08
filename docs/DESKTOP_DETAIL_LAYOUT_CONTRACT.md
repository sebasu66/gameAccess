# Desktop detail layout contract

Date: 2026-09-08
Status: implementation contract; visual acceptance remains evidence-based.

This document records the approved desktop detail behavior. It supersedes the earlier portrait/maximize-dependent visual experiment only. Unrelated Stage 2 tasks remain out of scope.

## Named regions

The normal desktop game detail uses one panel with three regions:

1. **First row** — selected game title, real Steam short description, the existing Play/Download/current-state action group on the left, and like/dislike on the right.
2. **Second row** — compact factual Steam information plus separately labelled GameAccess availability and active-download measurements only when real measurements exist.
3. **Third row and later** — About the Game, complete category/detail information, requirements, screenshots, and other extended content.

First and Second rows must remain visible together at every supported desktop size. Only Third row / extended content scrolls. Decorative media never determines the panel height or pushes the essential rows out of view.

## Desktop sizing

- Size from the actual available content viewport, not a portrait aspect ratio.
- No desktop `min-height: 760px`, no `aspect-ratio: 2 / 3` requirement, no negative-margin hero positioning.
- Use `min-width: 0` / `min-height: 0` where needed for shrinkable grid/flex children.
- Ordinary desktop widths should devote roughly 45–50% to detail.
- Cap detail around 900–1000 CSS px on ultrawide screens; the catalog receives the remaining width.
- Maximization does not choose a different media/content contract.
- At short heights, reduce decorative media/padding before reducing essential information. The complete title may wrap. Short description may clamp to 2–3 lines.

## First row controls

- Keep the existing `buildActions` state model and callbacks.
- The primary action label (`Jugar`, `Descargar`, cancellation/preparing state, etc.) stays visible without hover on the normal desktop detail panel.
- Preserve disabled/busy/cancel/preparing states and download-complete Play now / Not now behavior.
- Like/dislike controls stay compact but have at least 40×40 CSS px hit targets, visible selected state, accessible labels, and keyboard focus.
- Missing Steam short description reads `Descripción no disponible`; never substitute internal catalog/account copy as a game description.

## Selected-game detail loading

- The game already displayed when desktop starts is a real selection and must request details without requiring a second click.
- Rich details load asynchronously for the selected game only.
- Reuse the existing detail cache/deduplication path; do not add catalog-wide detail prefetch.
- Rapid A → B → C selection must ignore stale A/B results and never show them under C.
- Clear previous detail/media immediately on selection change and show the new game's lightweight fallback while loading.
- Preserve tablet's explicit details-open behavior and display IPC behavior.
- Loading, unavailable, error, and genuine empty data are distinct states; failures never block browsing.

## Desktop media sequence

Normal desktop detail uses one deterministic background media sequence in restored and maximized windows:

`highlighted/first playable Steam trailer → Steam full screenshots → repeat`

- Default screenshot hold: 8 seconds.
- Crossfade: approximately 600–800 ms.
- Trailer `ended` advances to screenshots; with trailer only, loop it; screenshot-only games rotate; a single image remains static.
- Use existing normalized playable video URLs. Media errors/autoplay failure fall back in a bounded way; never leave a permanent black panel or retry loop.
- Wide artwork/screenshots use `object-fit: cover`; preserve aspect ratio. Portrait capsule is fallback only.
- The media background covers both First and Second rows with a stable dark readability overlay.
- Start desktop video muted. Provide pause/resume for the whole sequence and sound controls. Pausing also freezes screenshot progression.
- Respect `prefers-reduced-motion` with a static initial background until explicit playback.
- Preload at most the current game's next screenshot and clean up timers/listeners/media on selection change/unmount.
- Do not alter the presentation/display surface's intentional looping/audio behavior.

## Second-row factual rules

- Display Steam-supplied genre, supported categories/functions, release/developer/publisher information, and platforms when available.
- Supported play modes/categories, maximum players per session, current concurrent players, and GameAccess copies are different facts.
- Never infer a numeric player count from categories, copies, ownership, or availability.
- If the current data path has no authoritative numeric max-player value, do not invent one; document it as unavailable.
- Unknown multiplayer data is `No informado`, not `Un jugador / no informado`.
- Keep `copies_available / copies_total` separate and explicitly labelled as GameAccess availability if shown.
- Downloaded bytes, speed, ETA and progress appear only for an applicable active tracked download and only when those values are known.

## Scope preservation

Preserve tablet/display surfaces, filtering/search, catalog modes, sorting, installed badges, preferences persistence, keyboard/controller navigation, visible grid scrolling, action lifecycle, Steam routing/login/entitlement, and download systems. Do not add another detail screen or duplicate Play/Download buttons.

## Required native viewport matrix

Record actual outer size, CSS viewport, OS scaling, and restored/maximized state. If a size cannot be achieved, mark it unverified.

| Target outer size | Purpose |
| --- | --- |
| 1024×700 | Declared supported minimum / height budget |
| 1280×720 | Short 16:9 |
| 1366×768 | Common laptop |
| 1440×900 | Default / 16:10 |
| 1920×1080 | Full HD |
| 1024×1200 | Tall restored |
| 2560×1080 | Ultrawide balance |
| Available native ultrawide | Detail-width cap |

At every size verify: complete title, nonempty available short description, applicable actions/preferences, entire Second row visible together without scrolling; no overlap or unintended horizontal scrolling; grid usable with visible scrollbar; media covers both essential rows; extended scrolling does not move First/Second rows; long-title behavior; restored/maximized transitions. Verify 100% and 125% scaling only when available without changing the user's OS settings.

## Completion evidence

A successful compile or one screenshot does not equal visual acceptance. Handback must separate implemented, automated-test verified, native-built, native-visually verified, and still-unverified claims. Record the exact commit, Windows build timestamp, executable path/SHA256, CI status, screenshot paths for the viewport matrix, media-cycle evidence, and unresolved data/quality-gate limitations.
