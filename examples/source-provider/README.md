# External source provider example

Download feeds belong to the external plugin. GameAccess does not ship feeds or use its catalog server to resolve hoster links.

Configured feeds keep their last valid response in the plugin's own user-data cache across restarts. A failed refresh retains that feed and retries after one minute; removed feeds are not read from the cache. Game identities use complete title tokens before accepting release/version metadata, so TRAIL OUT cannot match Rail Route and Alan Wake cannot match Alan Wake 2. The plugin reads every valid URI, removes duplicate links, and uses the same options for named search filters and game details. It resolves the selected option at download time through /api/prepare/:id. Gofile uses the host's current website token generator, account authorization, recursive folder discovery, and validation of the actual file. Its cookie stays inside the plugin's local streaming proxy, which forwards HTTP ranges and file metadata. Failed resolution returns an explicit error and never redirects to the original page.

Viking's current Hydra implementation uses a subscription unlock service. GameAccess PLUS acceleration and Viking cache are still pending. Viking page links therefore use the existing browser download flow. Direct files and torrents continue to use the download manager.

Run tests with node --test examples/source-provider/links.test.js. Mocked hoster responses verify protocol behavior; this does not prove every live hoster works.

To update the existing Electron plugin, execute the committed tools/windows/sync-source-provider.ps1 script with its explicit plugin directory. It backs up changed files, copies the GitHub-synchronized main.js, links.js matcher.js and feed-cache.js, verifies hashes, and restarts only that plugin. Existing package.json, index.html and user configuration are preserved.

References:
- https://github.com/hydralauncher/hydra/blob/main/src/main/services/hosters/vikingfile.ts
- https://github.com/hydralauncher/hydra/blob/main/src/main/services/hosters/gofile.ts

Startup uses Electron's single-instance lock. Duplicate launches focus the live window and exit. On Windows, the plugin inspects only processes with its exact executable and app identity; dot launches additionally require a renderer identifying the same app directory. Old windowless, failed or unresponsive main processes and detached children are rechecked with their creation time before termination. Fresh launches have a grace period. Healthy instances and unrelated port owners are preserved.

The API binds the preferred localhost port 45000, retries its saved fallback port, then lets the OS assign an available port. The manifest is published atomically after listening and includes its owner; an exiting duplicate cannot remove another instance's registration. Closing the main window also stops hidden helper windows and background service work.

GET /api/health exposes instance identity, source revision, dirty/syncing state and update time. Changed JSON or source configuration marks the catalog outdated; accepted content advances its revision only when the payload changes. Configured local JSON files are watched. Results produced for an older configuration are discarded and retried.

GameAccess checks the registry and health roughly every three seconds and refreshes availability, named filters and open game details on start, stop, endpoint changes or source revisions. It ignores responses from earlier plugin generations. Legacy providers keep a 30-second fallback refresh. This does not cancel an already running transfer when metadata changes.

Tests: node examples/source-provider/instance.test.js. Pass the existing Electron executable as a final argument for the isolated Windows/Electron lifecycle and JSON-watcher integration test.
