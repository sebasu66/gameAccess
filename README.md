# GameAccess

GameAccess is a Windows game library manager, a searchable Steam discovery
catalog and a generic torrent/file download manager.

- The installer includes the discovery database. Games remain searchable offline.
- The server discovers Steam releases and publishes verified database update packages.
- Users configure external plugins. Plugins supply game download sources; GameAccess
  does not bundle or distribute source lists.
- BASE permits one active download; PLUS permits four. Both support a download queue.
- PLUS can resolve client-provided sources through the server-side TorBox → ViKiNG cache; the server stores source fingerprints and checks that cached ViKiNG files still exist.
- Library membership is independent of installation. Uninstall keeps a game in the
  library; removing from the library also uninstalls it.
- Game details expose launch configuration and language repair through advanced options.
- Co-Optimus enrichment is requested only when a user opens the game details.

The earlier Steam account, license, rental and account-switching implementation
is preserved on [codex/legacy-steam-licenses](https://github.com/sebasu66/gameAccess/tree/codex/legacy-steam-licenses).
It is excluded from this version. GameAccess activation keys govern this application's
BASE/PLUS features and do not represent Steam licenses.

## Development

Read [AGENTS.md](AGENTS.md), [the execution protocol](docs/EXECUTION_PROTOCOL.md)
and [skill.md](skill.md) before implementation. Development uses `dev`; `main`
holds stable releases. Local agents edit and test the existing checkout first,
then commit/push on `dev`. GitHub-first is only for remote agents without direct
filesystem access. Do not create a new branch for each task.

The React/Tauri client is in apps/desktop, the central FastAPI service in apps/api,
and the bundled torrent/file, installation and execution helpers in apps/launcher.

```powershell
cd apps/desktop
npm ci
npm test
npm run tauri -- build
```

The NSIS installer includes the Python helpers and compressed SQLite catalog.
See [discovery maintenance](tools/catalog-cache/README.md),
[architecture](docs/architecture.md) and [the archive boundary](docs/STEAM_LICENSE_ARCHIVE.md).

Development references: [module ownership](docs/MODULE_MAP.md) and
[critical regression batches](docs/TESTING.md).
