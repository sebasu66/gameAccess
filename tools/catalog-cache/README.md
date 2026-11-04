# GameAccess discovery database

The catalog is metadata, independent of provider accounts, library membership,
installed games and plugin download availability. No download links are exported.

## Coverage and provenance

The seed includes the existing catalog, all games found in the public US/English
Steam Store search released in the rolling last 365 days, the first 5,000 games of
Steam's review ranking, and every game released in the last 10 years with at least
100 reviews (`--important-years`, `--important-min-reviews`). The full refresh takes about an hour. Steam's review ranking
groups games by score, not by review count, so its first pages alone missed about
half of the well-reviewed games since 2016; the whole ranking (~78,000 games) is read. DLC/software/bundles are excluded by the game search
filter and exact AppID row validation. Regionally unavailable, delisted or hidden
Steam products cannot be guaranteed by a public Store listing.

Discovery traverses newest releases until the date boundary. Empty/malformed
intermediate pages and exhausted retries abort publication. The coverage report
records the interval, counts, completion and source URL. No claim is based on an
AppID range. Existing localized full details are preserved. Missing player counts remain unknown.

Every catalog game is then read from `IStoreBrowseService/GetItems` (official, no key,
100 AppIDs per request): real cover URLs, Valve's age descriptors, player categories,
review count and percent positive, the 20 heaviest tags, release date, platforms and
temporary free offers (`steam_free_promo`: free weekend or free to keep, with its end
time). The central server no longer asks Steam for reviews.

Co-Optimus is separate: opening a game detail invokes a server lookup by exact
Steam AppID. Verified results cache for seven days; failures retry after an hour.
A 403 or an unverified XML result does not replace Steam data or invent players.
No Co-Optimus crawl runs during Steam discovery. The UI offers the original site.

## Distribution and client updates

Tauri resources include deploy/catalog-cache under runtime/catalog in every
installer. The first catalog load reads this SQLite seed without waiting for a
network response. An upgraded installer can replace an older seed offline, while
a newer downloaded database is retained.

At startup, then every 24 hours (and on focus once that time has passed) or on manual refresh, the client
reads the GitHub manifest (`catalog_manifest_url` in gameaccess.settings.json). An unchanged revision
downloads nothing. If the manifest lists an update from the client's revision under `updates`, only that
batch is downloaded; otherwise the full package is. A new package is checked against its SHA-256, SQLite
schema, revision and count before atomic replacement. Update failures preserve the previous catalog. The
previous library and downloads are stored separately.

The package is built only by the daily GitHub Actions job (`.github/workflows/discovery-catalog.yml`),
which commits it to `deploy/catalog-cache` on `dev`. The central server takes no part: it neither builds,
downloads nor serves the catalog, and game details are asked from Steam by each client on a local cache miss.
The only per-game server route left is GET /library/games/{app_id}/cooptimus.

The daily GitHub workflow also refreshes the committed installer seed on dev.
Scheduled workflows require this workflow to be integrated in the default branch.
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
tools/catalog-cache/test_discovery_catalog.py and apps/api/tests/test_catalog_updates.py.
