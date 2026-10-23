# GameAccess project guide

Read docs/EXECUTION_PROTOCOL.md and docs/architecture.md before implementation.
Use `dev` for development and `main` for stable releases; do not create a branch
for each task. Local agents with direct filesystem access edit and test in the
existing checkout first, then commit/push on `dev`. GitHub-first applies only to
remote agents: edit/push on the existing GitHub `dev` branch, synchronize through
AI_Local_Access, then build/test the exact commit. Preserve user changes.

## Product boundaries

GameAccess is a game library, discovery catalog and generic torrent/file
download manager. The product definition lives in vault/Proyecto.md; the task
board in vault/Tareas.md.

BASE permits one active download and PLUS four. Both share the same catalog,
placements, actions and persistent queue. PLUS source resolution can use the server-side
TorBox → ViKiNG cache. The server stores source fingerprints and result metadata, not
full source URLs or provider feeds.

Optional independent plugins provide download sources, archive passwords and execution profiles.
Manual links and profiles are user inputs and work without a plugin.
The GameAccess server never stores or distributes provider feeds, passwords or preparation procedures. The default Download action selects
their first ranked source. Keep its size in the label and show the available source
count in brackets. Advanced source choices belong behind the three-dot menu.
Source-name filters and source availability come from the plugin's source list,
synchronized into the local database (tables download_sources and game_sources);
this is the target design, see vault/Tareas.md task B.

## UX and execution

Use simple defaults and expandable advanced options. Filter groups start collapsed.
The only game-detail screen is the translucent overlay with its orange action.
Downloads navigate to that overlay. Terminal history is session-only and dismissible.

Membership is independent of installation. Uninstall keeps the game in the library;
remove-from-library also uninstalls. Installation folders include the Steam AppID.
Keep executable detection, game fixes, language repair and launch options intact.
Log source discovery, download lifecycle, installation and game execution.

## Metadata

Ship the SQLite discovery seed in every installer, read it before network waits,
and receive server batches at startup and at most daily. Merge additions and changed
records transactionally; never delete games or erase known fields with empty data.
Compare Steam AppID inventories to repair missing records. Entry is free
without a key; the activation key unlocks PLUS, not individual actions or catalog loading. Maintain Steam coverage
outside the desktop. Record provenance and coverage; unknown features stay unknown.
Co-Optimus is an optional cached lookup when the game detail opens.

## Validation

Inspect current cwd, branch, dirty state, imports and callers before editing.
Preserve private configuration and unrelated work. Run focused meaningful tests,
then the desktop suite/build when frontend/native paths change. Verify installer
payload and exact commit; compilation is not native visual acceptance.
