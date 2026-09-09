# Steam download manager

## Architecture

GameAccess download orchestration is owned by `SteamDownloadManager` in
`apps/launcher/provider_download_manager.py`.

The class is intentionally limited to download concerns:

1. resolve/validate a verified provider license;
2. estimate content size;
3. run the isolated Steam CDN transfer;
4. publish job status/progress/cancellation;
5. prepare completed files in the selected Steam library.

Account switching, game launch, leases, wallet/business rules and UI navigation
are outside this class.

`provider_download_probe.py` is the lower-level DepotDownloader adapter. It owns
one transfer process only and does not choose providers or Steam-library
placement.

## Parallel downloads

Different AppIDs use different worker processes and staging directories, so
GameAccess can run more than one game download at the same time.

DepotDownloader requires a distinct 32-bit `LoginID` for concurrent instances
using the same Steam account. GameAccess now reserves a unique LoginID for every
live DepotDownloader invocation instead of deriving one only from the provider
id. This permits the supported same-provider concurrency model without two live
workers sharing the same LoginID.

First-run tool bootstrap is protected by a cross-process lock so two workers
cannot download/extract the shared DepotDownloader installation simultaneously.
The Tauri start path is also serialized only around check/spawn/status
publication. This removes the duplicate-start race while allowing spawned game
workers to continue in parallel.

`-max-downloads 4` remains DepotDownloader's per-process chunk concurrency; it
is not the number of games GameAccess permits concurrently.

## Runtime lifecycle

1. Clicking **Download** creates/registers a GameAccess job.
2. The provider manager resolves an existing verified owner first; a SteamKit
   rescan is only a fallback when authoritative owner evidence is absent.
3. Manifest-only inspection estimates total content.
4. The real DepotDownloader worker transfers into the isolated GameAccess
   staging directory.
5. Progress/status is stored per AppID/job.
6. On completion GameAccess prepares the files in the requested Steam library,
   or chooses the first eligible library when no explicit selection was sent.
7. Steam remains the authority for final existing-files validation/install
   state.

## Steam library discovery and selection

The local Steam pool already exposes the configured library index/path pairs
parsed from `steamapps/libraryfolders.vdf` as `library_folders` and reports
`library_folder_count`.

The import/preparation layer already accepts an explicit `library_index`. The
provider download bridge now carries optional `library_index` through the Tauri
command, worker CLI and persisted job status. Existing callers that omit the
field keep the automatic first-eligible-library behavior.

The remaining customer-facing UI task is to present `library_folders` before a
GameAccess download and pass the selected index as `libraryIndex` to
`start_provider_download`.

## Steam client final install research

Steam's public `steam://install/<appid>` protocol does not expose a documented
library-folder argument.

The Steam client console exposes:

- `library_folder_list`
- `app_install <appid> [volumeindex]`

GameAccess already has `apps/launcher/steam_console_command.py`, which can send
console commands to the currently signed-in Steam client and capture newly
appended console log output without injecting credentials.

Before production code depends on `app_install <appid> <volumeindex>`, perform a
controlled Windows test comparing Steam's `library_folder_list` indexes with the
indexes parsed from `libraryfolders.vdf`, then verify one small install lands in
the requested library without requiring Steam's location picker.

## Steam progress source

The native Steam status bridge reads `appmanifest_<appid>.acf` across configured
libraries and uses `BytesDownloaded`, `BytesToDownload`, and `StateFlags`.
Provider downloads additionally publish their own staging progress until Steam
has taken over validation/install state.
