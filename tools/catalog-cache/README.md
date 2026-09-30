# GameAccess catalog cache

The desktop keeps static/semi-static game metadata in a local SQLite snapshot and asks
the GameAccess API only for live license availability.

## Distribution

Committed artifacts live in `deploy/catalog-cache/`:

- `catalog-manifest.json`: current immutable revision, SHA-256, row counts and artifact URL.
- `catalog-cache-<revision>.sqlite.gz`: compressed SQLite snapshot.

At startup Tauri fetches the small manifest. If the revision matches the local copy,
no catalog snapshot is downloaded. If it changed, Tauri downloads the immutable gzip,
verifies SHA-256, validates schema/revision/count, and atomically replaces the cache.

Local path on Windows:

`%LOCALAPPDATA%\GameAccess\cache\catalog.sqlite`

Live fields such as copies available, lease/demand state and price factors are never
treated as authoritative in this SQLite file. They are overlaid from
`GET /catalog/availability`.

## Rebuild

From the repository root:

```powershell
.\apps\api\.venv\Scripts\python.exe .\tools\catalog-cache\build_catalog_snapshot.py --github-ref dev
```

The builder defaults to `apps/api/gameaccess.db`. For the hosted PostgreSQL database,
set `GAMEACCESS_DATABASE_URL` or pass `--database-url`; never commit that credential.

## Community tags

`enrich_steamspy_tags.py` imports community tags into `game_tag` with
`source='steamspy'` and preserves SteamSpy vote counts in `weight`.

Example resumable batch:

```powershell
.\apps\api\.venv\Scripts\python.exe .\tools\catalog-cache\enrich_steamspy_tags.py --appdetails-limit 100 --max-tags 20
```

Responses are cached under the ignored `apps/api/.admin_tasks/` directory, so later
runs continue with unseen AppIDs rather than spending API requests again.

After tag enrichment, rebuild and commit a new snapshot. The manifest revision changes
from snapshot content, so clients will download it exactly once.
