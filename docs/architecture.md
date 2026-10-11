# GameAccess architecture

## Current product

GameAccess is a library manager, searchable Steam metadata catalog and generic
torrent/file download manager. User-supplied plugins own external download-source
configuration. Catalog membership and tags do not grant download availability.

Steam account rosters, ownership/family inventories, license capacity, rental
leases, provider credentials and account switching are preserved on
`codex/legacy-steam-licenses` and excluded from this branch. Existing local private
files and database records are not purged by the source cleanup.

## Components

- React/Tauri desktop: catalog and library UI, native caches, plugin discovery,
  BASE/PLUS concurrency (one/four), persistent queue and session download history.
- FastAPI server: GameAccess activation keys and plans, public discovery metadata,
  daily Steam maintenance, immutable update packages and optional lazy Co-Optimus
  detail enrichment. It does not hold game download sources.
- Bundled Python helpers: torrent/file downloads, extraction, app-ID installation
  folders, installed-file registry, executable selection, language repair and
  launching. Existing launch fixes and execution logs remain part of that flow.

The customer installs one Windows application. A localhost API is a development
convenience; production connects to a central HTTPS service. Both API processes
must connect to the same GameAccess Supabase PostgreSQL project. Configure
GAMEACCESS_DATABASE_URL in the server environment or ignored apps/api/.env;
missing configuration must fail clearly instead of creating a separate SQLite DB.
SQLite discovery packages remain client metadata caches, not the server database.
Isolated API tests use GAMEACCESS_ALLOW_SQLITE_FOR_TESTS=1 and synthetic data.

## Discovery

The installer includes deploy/catalog-cache under runtime/catalog. Catalog data
loads from the bundled SQLite snapshot before network synchronization.
The server discovers the rolling last year of public Steam releases and relevant
older titles, merges Store tags/reviews, and publishes a new immutable gzip only
after complete date-boundary traversal. It runs outside request handling.

The installer carries the complete discovery database before the first application
launch. The server retains immutable revisions and distributes compressed batches
of additions and changed records. Clients check once after startup and at most
daily, or on explicit refresh. Hash/schema/base-revision checks precede one SQLite
transaction. Updates never delete games or replace the local database; incomplete
fields cannot erase known metadata or cached details. Exact Steam AppID inventories
repair missing records independently of revision numbers. A legacy full package is
merged with the same preservation rules. Failed updates retain the usable catalog.
GitHub provides a fallback baseline and a daily installer-seed refresh.

Co-Optimus requests happen on opening a game detail. Exact Steam AppID matching
and response caching keep that work out of discovery and startup. Service errors
do not invent multiplayer details.

## Library and game execution

Adding a game to the library does not require installation. Uninstall removes game
files and keeps membership; remove-from-library removes both after confirmation.
Storage settings and per-game launch options remain separate from shared metadata.

Digital games launch through the existing executable detection/fix pipeline.
Already-installed Steam games can use their ordinary launch URI; GameAccess does
not log into Steam or switch its current account.

## Implementation workflow

GitHub is authoritative. Make code/documentation changes on the backed branch/PR,
push, synchronize through AI_Local_Access, and test the exact pushed checkout.
Keep unrelated local changes and private runtime configuration untouched.

## Optional source and execution boundary

The discovery/access API owns catalog packages and GameAccess access keys only.
Provider feeds, archive passwords and provider-specific game preparation belong to
independent optional plugins. Retired provider administration modules are archived
in Git history and are not imported or shipped by the active API.

A plugin's /api/prepare reply may include executionProfile; /api/execution-profile
can supply a profile for an existing installation. The profile is a versioned JSON
object with archivePasswords and beforePlay. Supported steps are ini-set (glob,
section, key, value) and run (an executable and argument list within the game's
folder). The generic runner preserves backup restoration, executable detection,
language repair and user launch preferences. It applies the selected optional
profile before Play. No extraction or Play request fetches provider data from the
GameAccess server. Locally saved per-game profiles remain usable with the plugin off.

Downloads has an Add manual download form. A detail's three-dot source chooser
also accepts a manual link. Only name/link are required; Steam identity, size,
archive passwords and a JSON profile stay behind Advanced options. Manual profiles
are never replaced automatically by provider defaults.

The activity console opens with the physical key to the left of 1 (Backquote) or
its Console button. It tails bounded application, download and execution logs only
while open; it can expand or pause. It masks credentials, and remote error reports
strip all download links and connection strings. Provider secrets never appear in
central logs. Co-Optimus uses an on-demand public-browser lookup in the desktop
with an exact Steam-link identity check, and a cached server lookup as fallback.

## Access to managed features and desktop shortcuts

GameAccess validates entry into the application and returns to activation when
its current session expires. Catalog synchronization is public and independent
of activation; managed actions do not perform separate access checks. Installed games and existing game processes remain independent;
expiry never deletes files or terminates a game.

Activation status supplies the server time, subscription expiry, permissions
and a lease expiry capped at five minutes. The native layer queries the trusted
API directly over TLS (loopback requires the explicit development-build flag),
refreshes the application session every minute. It never
accepts a frontend boolean or locally editable tier as authorization. A watchdog
expires the bounded grant independently of React, pauses transfers and exits
fullscreen. Loss of connection cannot extend the last grant. The UI returns to
activation. Leases are memory-only; session credentials retain Windows DPAPI.

Desktop .lnk files target the GameAccess executable with --launch-game APPID.
A single instance receives launch requests, preserves them through activation
and uses the existing folder/executable/profile launch pipeline after access
verification. Completed installations create shortcuts; the game detail options
also offer manual creation. No shortcut points directly at a game's executable.

This is service access control, not game DRM. Local development API instances
are trusted only for development; a distributed client must not contain database
credentials or privileged server configuration. Server-side validation remains
authoritative for remote protected endpoints.
