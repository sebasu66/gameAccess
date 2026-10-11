# Module ownership

Entry points compose services; they do not own download, catalog or activation
implementations. Follow the flow to its owner before changing behavior.

## Server (`apps/api/app`)

| Module | Responsibility |
| --- | --- |
| `main.py` | App composition, startup/shutdown and health |
| `models.py`, `api_schemas.py` | Persistent records and request contracts |
| `api_dependencies.py` | Shared session injection |
| `catalog_routes.py`, `steam_search_routes.py` | Public catalog/detail/search endpoints |
| `catalog_metadata.py`, `discovery_service.py` | Durable catalog data and update packages |
| `steam_client.py`, `review_maintenance.py` | Shared Steam adapter and review maintenance |
| `activation_routes.py`, `access_service.py` | Client activation and session checks |
| `access_admin_routes.py`, `admin_security.py` | Administrative access-key operations |
| `client_error_routes.py` | Sanitized client error reports and views |
| `request_diagnostics.py` | Request-owned diagnostic context |

Routes import models, dependencies and domain services directly, never `main.py`.
Catalog handlers use their injected session's database. The server does not
receive provider passwords, feeds or preparation profiles.

## Native desktop (`apps/desktop/src-tauri/src`)

| Module | Responsibility |
| --- | --- |
| `main.rs` | Tauri setup, state and command registration |
| `steam_commands.rs` | Native catalog/library and system command adapters |
| `digital_commands.rs` | Python worker IPC, ownership, controls and status |
| `download_events.rs` | Download lifecycle IPC |
| `access_commands.rs` | Activation IPC, watchdog and shortcuts |
| `launcher_runtime.rs` | Launcher and Python runtime location |
| `plugin_registry.rs` | Optional source-provider discovery |
| `execution_profiles.rs` | Local profile IPC and optional Co-Optimus query |
| `activity_log.rs` | Activity log persistence and console reads |
| `visual_debug.rs` | Visual-debug session, viewport and captures |

Command names and JSON contracts remain stable. Native adapters call existing
domain modules such as `access_policy`, `catalog_cache` and `native_core`.

## Launcher (`apps/launcher`)

| Module | Responsibility |
| --- | --- |
| `digital_downloader.py` | CLI, signals, control-file polling and status output |
| `download_pipeline.py` | Transfer → extraction → completed orchestration |
| `download_context.py` | Explicit runtime callbacks/state supplied to workers |
| `download_source_validation.py` | Link and downloaded-file validation |
| `http_download_transport.py` | HTTP streaming, ranges, retries and accounting |
| `torrent_download_transport.py` | Local libtorrent transfer |
| `debrid_client.py` | Existing optional resolver adapter |
| `archive_extractor.py` | Archive ordering, extraction and backup policy |
| `digital_process_runner.py` | Play/uninstall dispatch and executable selection |
| `digital_storage.py`, `digital_backup.py` | AppID folder identity and retained archives |
| `execution_profile.py`, `digital_game_options.py` | Local preparation and launch options |
| `flow_diagnostics.py` | One-operation diagnostic buffer |

Transports and extraction depend on `DownloadContext`, not the CLI module.
The CLI retains compatibility functions for callers and fixtures. Runtime
staging and native integration fixtures copy every root Python module.

## React (`apps/desktop/src`)

`LibraryRoom.tsx` owns presentation and navigation. `useLibraryDownloads.ts`
owns download tracking, completion persistence and reconciliation timers.
`catalog/DigitalCatalog.ts` owns catalog/detail orchestration, `PluginSources.ts`
owns optional provider requests, and `FlowDiagnostics.ts` owns operation detail.
There is no presentation redesign in this extraction.

## Diagnostics

Each transaction owns a complete in-memory buffer, without an event/byte limit.
The operation supplies its AppID and/or flow ID. DEBUG entries are never written
on success: success and explicit cancellation discard and release the buffer.
Failure flushes the preceding detail in order once, writes the error, and releases
the buffer. Concurrent transactions do not share buffers. INFO milestones remain
durable and visible through the existing activity console (the key left of `1`).

HTTP range attempts, source discovery/resolution, catalog/detail cache decisions,
extraction entry and executable selection have diagnostic steps. Credentials and
provider URLs are excluded or redacted. Existing on-disk log rotation is separate
from transaction buffering. Logs do not replace functional regression tests.
