# GameAccess Stage 2 — confirmed fixes and UI contract

Date: 2026-09-08

This document is the authoritative Stage 2 correction list agreed with the user. It exists so future work can distinguish an intentional product rule from a regression. Do not silently reinterpret these rules during refactors.

## Delivery order

### A. Visual detail-panel experiment — do this first

- [ ] Keep the normal, non-maximized desktop window approximately 50/50 between the game detail panel and the game grid.
- [ ] In that portrait-like detail panel, use Steam portrait/library artwork and make the artwork substantially larger than the current top strip.
- [ ] Put the game title on top of the artwork, not in a separate block. Use a subtle dark shade/gradient behind it so it is always readable.
- [ ] When the GameAccess window is maximized, change the desktop split to approximately 70/30, with the detail panel taking the larger share and the game grid the smaller share.
- [ ] In maximized mode, use wide Steam artwork appropriate to the larger detail panel.
- [ ] In maximized mode, rotate the hero media as a slideshow between the Steam/library hero/banner and the game's Steam screenshots. Crossfade rather than hard-cut where practical.
- [ ] Keep the main Play/Download/Cancel action immediately above the game facts/details area and in a stable location.
- [ ] Put the primary action on the left of that row.
- [ ] Put small thumbs-up / thumbs-down preference buttons on the right of that same row.
- [ ] Keep the factual game-information table below that control row, toward the bottom/content portion of the panel.
- [ ] Preserve tablet and presentation/display surfaces; this experiment targets the normal desktop library.

The user wants to inspect this visual experiment in the real Windows app before the rest of Stage 2 is implemented.

## B. Grid context menu

- [ ] Right-click `Open installation folder` must only be present for games actually installed on this machine.
- [ ] Non-installed games must not show the installation-folder command at all. A disabled meaningless local-path command is not desired.
- [ ] Installation evidence is independent of whether a runnable license/copy is currently available.

## C. Steam details: lazy, faithful and cached

- [ ] When a game is opened/shown in the detail panel for the first time, retrieve the richer Steam data available for that game.
- [ ] Cache reusable detail results by stable game/AppID/source identity so revisiting the game does not repeat the expensive retrieval.
- [ ] Do not prefetch rich Steam details across the full catalog.
- [ ] Preserve Steam's terminology and representation as closely as possible rather than inventing derived/reformatted facts.
- [ ] Include missing Steam information such as player/multiplayer support and other useful fields Steam itself exposes.
- [ ] The real Steam game description must appear below/with the title once loaded. Do not substitute internal copy such as `Seleccionado de la biblioteca combinada de tus cuentas Steam` when real description exists.

## D. Copies / availability count accuracy

- [ ] Verify exactly what `copies_available / copies_total` means before trusting values such as `1 / 2`.
- [ ] Counts must be backed by actual runnable local/provider routes and current capacity, not stale ownership metadata or an inferred number.
- [ ] If the value cannot be substantiated, do not display a misleading count.

## E. Download information hygiene

- [ ] Do not show Downloaded, Speed or Remaining Time when the game is not actively downloading.
- [ ] While an actual download is active, show those values only when they are measured/known from a trustworthy source.
- [ ] Do not show fabricated estimates, empty junk fields or misleading zeroes.
- [ ] Static installed/download size may remain only when its meaning/source is correct and clearly identified.

## F. Detail-panel copy and labels

- [ ] Hide the `MODO VITRINA` / `TU BIBLIOTECA` eyebrow in the normal desktop detail panel for now rather than inventing a new meaning.
- [ ] A future source/license label may be useful, but do not redundantly display `GameAccess` inside a tab where every game already has that source.
- [ ] Always prefer the real Steam description once lazy detail data is available.

## G. Top catalog navigation

- [ ] Hide the Store tab for now; preserve the implementation for later rather than deleting the feature.
- [ ] Show only `Propios` and `GameAccess` in Stage 2.
- [ ] Move the visible tab controls down so they align vertically with the search field and are fully inside the visible application area.

## H. Keyboard and focus contract

Normal library operation has three valid focus zones: **game grid**, **game detail/actions**, and **search field**. Temporary modal dialogs may own focus while open and must restore an appropriate library zone when closed.

### Game grid — default zone

- [ ] The grid is the default keyboard zone when the GameAccess library opens or a catalog tab finishes loading.
- [ ] Arrow keys navigate the actual grid rows/columns.
- [x] Keyboard selection must automatically remain visible by scrolling the game grid. Initial correction landed as `9b4bfe8`; retain this behavior while replacing WASD navigation.
- [ ] Enter on a selected game enters its detail/actions area. The same Enter press must not immediately Play/Download.
- [ ] Escape on an unfiltered grid does not close GameAccess.
- [ ] If a filter is active, Escape on the grid clears the filter and returns to the unfiltered catalog.
- [ ] Letter keys are not directional navigation. A printable letter pressed on the grid jumps to the first game beginning with that letter, comparable to Windows Explorer behavior.
- [ ] Letter-jump operates within the currently filtered result set when a filter is active.
- [ ] Remove WASD as navigation keys. W/A/S/D participate in normal letter-jump behavior instead.

### Detail/actions zone

- [ ] Enter activates the currently focused valid action.
- [ ] Escape returns to the same selected game in the grid and preserves the useful grid scroll position.
- [ ] Action navigation must not accidentally move the game-grid selection.

### Catalog tabs

- [ ] Tab switches between `Propios` and `GameAccess` while in the normal library context.
- [ ] Shift+Tab switches in the opposite direction/circularly as appropriate.
- [ ] Switching catalog returns operational focus to a valid game-grid selection.
- [ ] Modal-dialog Tab navigation remains inside the modal and must not switch catalog.

### Search

- [ ] Ctrl+F moves focus to the GameAccess search field and prevents browser/WebView find UI.
- [ ] Text input behaves normally; letter keys inside search never trigger grid navigation.
- [ ] Do not apply filtering for 0–2 typed characters.
- [ ] At 3 or more characters, apply the search automatically as the user types.
- [ ] Once applied, maintain an explicit filtered state/criteria while the user navigates games or opens details.
- [ ] Enter in search keeps the current criteria and moves focus to the game grid.
- [ ] The filter remains until Escape is pressed from the game grid; that Escape clears criteria and restores the full catalog.

### Window focus restoration

- [ ] GameAccess must not leave operational keyboard focus on arbitrary body/decorative/title-bar elements.
- [ ] When the window regains focus, restore the last valid library focus zone (grid, detail/actions or search) unless a modal currently owns focus.
- [ ] Do not use a render loop that continually steals focus from legitimate inputs or dialogs.

## I. On-screen control legend and project contract

- [ ] Update the bottom-left/main-screen instruction legend to match the real controls. Remove WASD instructions.
- [ ] The legend must communicate Arrow navigation, Enter, Escape, Tab and Ctrl+F as appropriate without claiming unsupported behavior.
- [ ] Copy the stable interaction rules from this document into the main project README and/or `docs/DESKTOP_UI.md` after the visual experiment is accepted, so regressions can be judged against a durable specification.

## J. Catalog pagination and scalable navigation

- [ ] Do not require loading the entire catalog into the desktop UI as one in-memory array as the library grows beyond ~1,000 games.
- [ ] Add backend/API pagination with stable ordering and stable game IDs.
- [ ] Fetch additional pages on demand as navigation/scrolling requires them.
- [ ] Search/filtering must query the catalog correctly rather than only filtering whatever page happens to be loaded locally.
- [ ] Letter-jump must resolve against the relevant catalog/filter result, not merely the currently mounted DOM cards.
- [ ] Reaching the end of a loaded page with keyboard navigation should transparently acquire the next needed page without blocking the UI thread.

## Non-regression rules for Stage 2

- Preserve working Steam login/account-switch/download/launch mechanisms.
- Do not start real Steam login/download/launch tests without explicitly warning the user first.
- Preserve installed-state indicators and download-complete behavior.
- Preserve local-first runnable routing with GameAccess/provider fallback.
- Keep rich detail loading asynchronous and selected-game-only.
- Do not change tablet/display behavior as collateral damage from the normal desktop redesign.

## Detail panel row terminology

For Stage 2 visual discussions, the desktop game detail panel uses these stable names:

- **First row**: Steam artwork/slideshow plus the game title, short description, primary Play/Download/Cancel action, and like/dislike controls. The artwork is the visual background of the entire row, including the controls.
- **Second row**: factual game metadata (genre, multiplayer, developer, publisher, release, copies and download facts). Steam-derived fields remain factual and are not marketing copy.
- **Third row**: Steam “About the game” content, preserving readable paragraph/list emphasis instead of flattening the HTML into one line.
- Additional sections (requirements, screenshots, etc.) follow below and remain reachable by scrolling.
- Normal/restored desktop keeps the 50/50 detail/grid split and makes the First row tall enough for the portrait Steam Library Capsule without cropping. Maximized desktop uses the detail-heavy 70/30 split and wide high-resolution Steam hero/screenshots.
