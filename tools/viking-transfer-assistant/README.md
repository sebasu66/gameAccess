# GameAccess Torrent ↔ ViKiNG Test Assistant

Small Windows GUI for validating the two independent GameAccess transfer flows.

## Flow 1 — Torrent → ViKiNG

Accepted torrent inputs:

- magnet link;
- local `.torrent` file;
- direct `http(s)` URL to a `.torrent` file.

For a direct URL, the assistant downloads only the small `.torrent` metadata file. The torrent payload is handled by Real-Debrid and then transferred server-to-server to ViKiNG using ViKiNG's remote-upload API.

A Real-Debrid Premium API token is required by this prototype. `REAL_DEBRID_TOKEN` can also be supplied as an environment variable. An optional `VIKING_USER_HASH` is supported.

The upload tab shows torrent status/progress and displays the final ViKiNG `/f/...` link when complete.

## Flow 2 — ViKiNG → PC

Paste a ViKiNG file link, choose a local destination, and start the automatic download.

The assistant launches the Tauri/WebView2 ViKiNG downloader in `tools/viking-webview-probe`, follows the normal visible download flow, captures Tauri's download event, redirects the browser download to the selected local path, and reports success/failure and bytes received.

## Run

On Windows:

```text
run.cmd
```

The runner builds the Tauri probe automatically if the release executable is missing, then starts the Python/Tkinter GUI.

Use only content you are authorized to download, store, and redistribute.
