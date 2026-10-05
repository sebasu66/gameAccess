# Digital archive passwords and error reporting

The central password list is stored on the API server in `apps/api/data/contraseñas_zip`, one password per line. Set `GAMEACCESS_ARCHIVE_PASSWORD_FILE` to use a persistent server storage location. The list is runtime data and must not be committed.

Open the administration panel, select **Herramientas**, and use **Contraseñas de archivos Digital**. Supply the existing server admin token, load the current list, edit it, and save. Reading and writing require the same admin authorization as access-key management.

An encrypted archive requests the list only after extraction rejects the initial password. The activated client retrieves `GET /digital/archive-passwords` with its activation session and installation identifier, then delivers it to the worker through the native bridge. The bridge reply is temporary, is consumed and deleted by the worker, and is excluded from download history and logs. The worker tries the server passwords in order. Missing server access, exhaustion, malformed replies and delivery timeout produce an error while preserving the completed download.

7-Zip runs without interactive input and reports extraction percentages. Each worker extracts only archives from its own downloaded target. Extraction errors stop the pipeline rather than being overwritten by successful installation/completion.

Digital download, extraction, installation, control, status-probe and process execution failures use the existing `narrate(..., { level: "ERROR" })` path to `POST /client-errors`. Reports carry AppID and execution area. Repeated identical worker snapshots are deduplicated. Server review uses the existing client error admin endpoints.

To retry only extraction of an already downloaded archive, run the committed `digital_downloader.py` with `--app-id`, `--name`, `--extract-only PATH`, `--destination-dir PATH` and `--keep-archive`. The desktop manager must be running and monitoring the same AppID to provide central passwords. Do not run a second worker for the same AppID while the old worker is active.
