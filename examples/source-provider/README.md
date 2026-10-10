# External source provider example

Download feeds belong to the external plugin. GameAccess does not ship feeds or use its catalog server to resolve hoster links.

The plugin reads every valid URI, removes duplicate links, and uses the same options for named search filters and game details. It resolves the selected option at download time through /api/prepare/:id. Gofile uses the host's current website token generator, account authorization, recursive folder discovery, and validation of the actual file. Its cookie stays inside the plugin's local streaming proxy, which forwards HTTP ranges and file metadata. Failed resolution returns an explicit error and never redirects to the original page.

Viking's current Hydra implementation uses a subscription unlock service. GameAccess PLUS acceleration and Viking cache are still pending. Viking page links therefore use the existing browser download flow. Direct files and torrents continue to use the download manager.

Run tests with node --test examples/source-provider/links.test.js. Mocked hoster responses verify protocol behavior; this does not prove every live hoster works.

To update the existing Electron plugin, execute the committed tools/windows/sync-source-provider.ps1 script with its explicit plugin directory. It backs up changed files, copies the GitHub-synchronized main.js and links.js, verifies hashes, and restarts only that plugin. Existing matcher.js, package.json, index.html and user configuration are preserved.

References:
- https://github.com/hydralauncher/hydra/blob/main/src/main/services/hosters/vikingfile.ts
- https://github.com/hydralauncher/hydra/blob/main/src/main/services/hosters/gofile.ts
