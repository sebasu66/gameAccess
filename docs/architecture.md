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
convenience; production connects to a central HTTPS service.

## Discovery

The installer includes deploy/catalog-cache under runtime/catalog. Catalog data
loads from the bundled SQLite snapshot before network synchronization.
The server discovers the rolling last year of public Steam releases and relevant
older titles, merges Store tags/reviews, and publishes a new immutable gzip only
after complete date-boundary traversal. It runs outside request handling.

Clients check the server manifest after first paint and every 30 minutes. On a new
revision they verify the package hash, schema, revision and row count, then replace
their cached database atomically. A failed update leaves the previous database
available. GitHub provides a fallback manifest and a daily installer-seed refresh.

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
