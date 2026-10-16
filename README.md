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

Activation keys unlock the PLUS features of this application.

Project definition: [vault/Proyecto.md](vault/Proyecto.md). Task board: [vault/Tareas.md](vault/Tareas.md).

## Development

Read [AGENTS.md](AGENTS.md), [the execution protocol](docs/EXECUTION_PROTOCOL.md)
and [skill.md](skill.md) before implementation. Development uses `dev`; `main`
is only updated when the project is ready for its first live test (there are no
users yet). Local agents edit and test the existing checkout first, then commit
and push each verified step to `dev`. GitHub-first is only for remote agents
without direct filesystem access. Do not create a new branch for each task.

The React/Tauri client is in apps/desktop, the central FastAPI service in apps/api,
and the bundled torrent/file, installation and execution helpers in apps/launcher.

```powershell
cd apps/desktop
npm ci
npm test
npm run tauri -- build
```

The NSIS installer includes the Python helpers and compressed SQLite catalog.
See [discovery maintenance](tools/catalog-cache/README.md) and
[architecture](docs/architecture.md).

Development references: [module ownership](docs/MODULE_MAP.md) and
[critical regression batches](docs/TESTING.md).
