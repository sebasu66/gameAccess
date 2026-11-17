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

Each server source has an editable auto_installed flag, false by default, in the Digital sources table and add-source form. The selected source policy is included in /digital/catalog and /digital/source responses and passed through the native bridge to extraction and Play. Existing database sources are migrated with false; partial source edits preserve their policy.

For sources with auto_installed=false, archive sets are extracted by descending file size so the smallest archive is last. Multipart continuation volumes are never independently extracted. If the last archive has loose contents, those contents are extracted into the game subfolder established by the larger archive; an archive with its own enclosing folder keeps that layout. A single portable archive still uses the game's download folder.


Extraction overwrites files without prompting (-y -aoa). The smallest original archive is renamed in its download location to <game name>_backup.<original extension>, preserving its compressed bytes; other downloaded archives are deleted after successful extraction. Multipart backups retain their required companion volumes. No new ZIP is created. A small .digital-backup.json record stores archive and extraction paths without any passwords. Every Digital Play reapplies that retained archive into the same destination before spawning the game; failure aborts launch and follows DIGITAL_EXECUTION support reporting. Encrypted backups obtain the current central password list before restoration. Backups are excluded from normal directory extraction scans.

Sources with auto_installed=true use ordinary extraction order and destinations, skip existing destination files, delete successful downloaded archives without retaining a backup, and do not restore backups or request backup passwords before Play. The Digital folder lifecycle remains independent of Steam for both settings.
