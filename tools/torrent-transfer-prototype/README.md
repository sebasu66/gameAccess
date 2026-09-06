# Torrent → file host prototype

Standalone Windows proof-of-concept for a **server-to-server** transfer pipeline:

```text
.torrent / magnet
       ↓
Real-Debrid torrent service
       ↓
remote-friendly HTTPS URL (`unrestrict/link`, `remote=1`)
       ↓
ViKiNG FiLE or FileQ remote URL upload
       ↓
final hosted link
```

The application intentionally does **not** implement a local BitTorrent client and does not relay the file through the GameAccess PC. It only sends API/control requests.

Use this prototype only with content you are authorized to download and redistribute.

## Why these providers

### Torrent side: Real-Debrid

Official API supports:

- `.torrent` upload (`PUT /torrents/addTorrent`);
- magnet links (`POST /torrents/addMagnet`);
- file selection (`POST /torrents/selectFiles/{id}`);
- progress/status (`GET /torrents/info/{id}`);
- remote-friendly unrestricted URLs (`POST /unrestrict/link`, `remote=1`).

A Real-Debrid Premium account is required for torrent endpoints.

### Destination 1: ViKiNG FiLE — default

Official API documents remote URL upload directly from a `link`. It can be used anonymously (`user` is empty), advertises unlimited file size/storage, and regular/free files are deleted 15 days after the last download. The API also has `check-file`, which the prototype uses for post-upload verification when a file hash is returned.

### Destination 2: FileQ

Official API documents remote URL upload. Its free registered tier currently documents a 5 GB maximum file and 20-day retention after last download.

The public FileQ API example returns `WORKING` for remote upload but its example does not show the `file_code` in that initial response. This prototype supports documented/observed `file_code` response variants and intentionally fails clearly rather than guessing if the server accepts the upload without returning a tracking code.

## Run

No third-party Python packages are required. Python 3 with Tkinter is enough.

On Windows:

```text
run.bat
```

Or:

```text
python app.py
```

## Credentials

Paste credentials into the UI, or set:

```text
REAL_DEBRID_TOKEN
FILEQ_API_KEY
VIKING_USER_HASH
```

The UI does not persist credentials and logs never print them.

For a public/distributed application, replace private Real-Debrid tokens with the OAuth device/application flow documented by Real-Debrid.

## Usage

1. Paste a magnet link, or browse to a local `.torrent` file.
2. Choose **ViKiNG FiLE (anonymous)** or **FileQ**.
3. Choose:
   - **Largest file** — default, useful for a torrent containing one primary ISO/archive/video;
   - **All files** — transfers every selected output Real-Debrid exposes.
4. Paste the Real-Debrid API token.
5. For FileQ, provide the FileQ API key.
6. Click **Start server-to-server transfer**.
7. Watch torrent status/progress and destination status.
8. Final destination links appear in the log and can be copied.

## Tests

```text
python -m unittest -v test_transfer_core.py
```

The unit tests are offline and do not consume torrent/file-host traffic.

## Live-test checklist

A true end-to-end test requires:

- a Real-Debrid Premium token;
- a legal/public-domain test torrent or magnet;
- no credential for anonymous ViKiNG;
- a FileQ key only when testing FileQ.

The smallest live test is a tiny legal torrent with **ViKiNG anonymous**. Confirm:

1. Real-Debrid status reaches `downloaded`;
2. the app receives an unrestricted URL with `remote=1`;
3. ViKiNG remote upload returns a final URL;
4. ViKiNG `check-file` confirms it exists;
5. opening/downloading the final link yields the expected file.
