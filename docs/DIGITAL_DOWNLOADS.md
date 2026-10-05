# Digital archive passwords and error reporting

The central password list is stored on the API server in `apps/api/data/contraseñas_zip`, one password per line. Set `GAMEACCESS_ARCHIVE_PASSWORD_FILE` to use a persistent server storage location. The list is runtime data and must not be committed.

Open the administration panel, select **Herramientas**, and use **Contraseñas de archivos Digital**. Load the current list, edit it, and save. Direct local administration needs no token. Hosted administration uses one sign-in at /admin-session/login and a shared, HttpOnly session cookie for all admin pages and actions. Individual forms do not request tokens. The session expires after 12 hours or logout; changing the server admin token invalidates existing sessions.

An encrypted archive requests the list only after extraction rejects the initial password. The activated client retrieves `GET /digital/archive-passwords` with its activation session and installation identifier, then delivers it to the worker through the native bridge. The bridge reply is temporary, is consumed and deleted by the worker, and is excluded from download history and logs. The worker tries the server passwords in order. Missing server access, exhaustion, malformed replies and delivery timeout produce an error while preserving the completed download.

7-Zip runs without interactive input and reports extraction percentages. Each worker extracts only archives from its own downloaded target. Extraction errors stop the pipeline rather than being overwritten by successful installation/completion.

Digital download, extraction, installation, control, status-probe and process execution failures use the existing `narrate(..., { level: "ERROR" })` path to `POST /client-errors`. Reports carry AppID and execution area. Repeated identical worker snapshots are deduplicated. Server review uses the existing client error admin endpoints.

To retry only extraction of an already downloaded archive, run the committed `digital_downloader.py` with `--app-id`, `--name`, `--extract-only PATH`, `--destination-dir PATH` and `--keep-archive`. The desktop manager must be running and monitoring the same AppID to provide central passwords. Do not run a second worker for the same AppID while the old worker is active.

## Portable Digital lifecycle

DigitalGameStorage owns each game's download folder under launcher/games and remembers it by Digital ID in .cache/digital_games. Existing named game folders are reused in place. New games use ID-name folders to isolate parallel downloads. HTTP, TorBox and torrent content is downloaded and extracted there. Extraction is the installation; installProcess and uninstallProcess are ignored. There is no Steam staging, relocation, manifest, account or lease dependency.

DigitalProcessRunner launches the configured relative executable inside that folder, or discovers the only game executable when playProcess is empty. Its working directory is the executable's directory inside the downloaded folder. Ambiguous executables produce a support-reported error rather than launching Steam. Folder presence with unpacked payload determines availability; empty folders and archive-only downloads are not ready. The UI probes folder state on startup, focus and every 15 seconds, rather than trusting completed history. Uninstall deletes only the checked Digital folder and its local bookkeeping. Root, external and redirected folders are refused.

GameAccess storage hygiene explicitly excludes the entire Digital games root and Digital folder registry, including legacy, partial, failed and completed downloads. Digital removal belongs only to its explicit uninstall action; Steam staging discovery and pruning cannot reclaim those folders.

Archive sets are extracted by descending file size so the smallest archive is last. Multipart continuation volumes are never independently extracted. If the last archive has loose contents, those contents are extracted into the game subfolder established by the larger archive; an archive with its own enclosing folder keeps that layout. A single portable archive still uses the game's download folder.

Extraction overwrites destination files without prompting (7-Zip -y -aoa). After the last archive is extracted, backup for <game name>.zip is created atomically inside the game folder with only that archive's incoming payload files, including their new bytes when they replaced older files. It excludes unrelated game files and the old replaced versions. Generated backups are excluded from future archive scans. Backup failure reports an extraction error and retains the original archive.
