# GameAccess discovery database

The catalog is metadata, independent of provider accounts, library membership,
installed games and plugin download availability. No download links are exported.

## Coverage and provenance

The seed includes the existing catalog, all games found in the public US/English
Steam Store search released in the rolling last 365 days, and the first 5,000 games
ranked by Steam review count. DLC/software/bundles are excluded by the game search
filter and exact AppID row validation. Regionally unavailable, delisted or hidden
Steam products cannot be guaranteed by a public Store listing.

Discovery traverses newest releases until the date boundary. Empty/malformed
intermediate pages and exhausted retries abort publication. The coverage report
records the interval, counts, completion and source URL. No claim is based on an
AppID range. Store tags and review summaries accompany the basic records; existing
localized full details are preserved. Missing player counts remain unknown.

Co-Optimus is separate: opening a game detail invokes a server lookup by exact
Steam AppID. Verified results cache for seven days; failures retry after an hour.
A 403 or an unverified XML result does not replace Steam data or invent players.
No Co-Optimus crawl runs during Steam discovery. The UI offers the original site.

## Distribution and client updates

Tauri resources include deploy/catalog-cache under runtime/catalog in every
installer. The first catalog load reads this SQLite seed without waiting for a
network response. An upgraded installer can replace an older seed offline, while
a newer downloaded database is retained.

Five seconds after catalog display, then every 30 minutes, on focus after that
interval and on manual refresh, the client checks the configured server's
/library/catalog/manifest. It falls back to the configured GitHub manifest.
An unchanged revision downloads nothing. A new package is checked against its
SHA-256, SQLite schema, revision and count before atomic replacement. Update
failures preserve the previous catalog. The previous library and downloads are
stored separately.

The central API maintains the discovery package on a background thread, starting
15 seconds after server startup and repeating every 24 hours. It never blocks
health, login or catalog requests. Deployment with multiple API workers should
disable GAMEACCESS_DISCOVERY_SYNC on web workers and run one scheduled maintenance
worker. GAMEACCESS_DISCOVERY_DIR selects the writable package directory and
GAMEACCESS_DISCOVERY_INTERVAL_SECONDS selects the interval (minimum one hour).

Server routes:
- GET /library/catalog/manifest
- GET /library/catalog/packages/{revision}
- GET /library/catalog/status
- GET /library/games/{app_id}/cooptimus

The daily GitHub workflow also refreshes the committed installer seed on dev.
Scheduled workflows require this workflow to be integrated in the default branch.
The server keeps earlier immutable packages for clients already downloading them.
Operational request caches and third-party response caches stay outside Git.

## Administrative refresh

```powershell
.\apps\api\.venv\Scripts\python.exe .\tools\catalog-cache\refresh_discovery_catalog.py --github-ref dev
```

Requests use a >=1 second delay, bounded retries/backoff and a disk cache. To
export the canonical SQL database instead, build_catalog_snapshot.py now exports
all active game metadata without accountgame restrictions. It includes existing
genres/categories/tags and verified player counts.

Optional administrative JSON enrichment (SteamSpy/PCGamingWiki/Co-Optimus) accepts
exact app_id, source, source_url, tags and verified player-count fields through
--enrichment-file. Never match by fuzzy title. Existing SteamSpy scripts remain
available for deeper tag enrichment. PCGamingWiki's path importer remains separate.

For validation use PYTHONPATH=apps/api and run pytest on
tools/catalog-cache/test_discovery_catalog.py and apps/api/tests/test_discovery_service.py.
