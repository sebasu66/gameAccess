# GameAccess project guide

Read docs/EXECUTION_PROTOCOL.md and docs/architecture.md before implementation.
Use `dev` for development and `main` for stable releases; do not create a branch
for each task. Local agents with direct filesystem access edit and test in the
existing checkout first, then commit/push on `dev`. GitHub-first applies only to
remote agents: edit/push on the existing GitHub `dev` branch, synchronize through
AI_Local_Access, then build/test the exact commit. Preserve user changes.

## Product boundaries

GameAccess is a game library, Steam discovery catalog and generic torrent/file
download manager. It does not manage Steam accounts, licenses, rental leases or
account switching. The former implementation is preserved on
codex/legacy-steam-licenses; see docs/STEAM_LICENSE_ARCHIVE.md.

BASE permits one active download and PLUS four. Both share the same catalog,
placements, actions and persistent queue. Debrid acceleration and Viking Files
cache remain unimplemented.

Optional independent plugins provide download sources, archive passwords and execution profiles.
Manual links and profiles are user inputs and work without a plugin.
The GameAccess server never stores or distributes provider feeds, passwords or preparation procedures. The default Download action selects
their first ranked source. Keep its size in the label and show the available source
count in brackets. Advanced source choices belong behind the three-dot menu.
Source-name filters come from live plugins; source availability must not come from
the discovery database, a Steam disk requirement or a license pool.

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
Compare Steam AppID inventories to repair missing records. Activation gates entry
and session lifetime, not individual actions or catalog loading. Maintain Steam coverage
outside the desktop. Record provenance and coverage; unknown features stay unknown.
Co-Optimus is an optional cached lookup when the game detail opens.

## Validation

Inspect current cwd, branch, dirty state, imports and callers before editing.
Preserve private configuration and unrelated work. Run focused meaningful tests,
then the desktop suite/build when frontend/native paths change. Verify installer
payload and exact commit; compilation is not native visual acceptance.
