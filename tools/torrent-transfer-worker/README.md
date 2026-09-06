# GameAccess torrent transfer worker (no premium account)

Prototype worker for transferring an authorized torrent directly into ViKiNG FiLE without Real-Debrid, Seedr, or another premium torrent service.

## Architecture

```text
magnet / .torrent URL
        ↓
WebTorrent on our worker
        ↓
selected file ranges
        ↓
ViKiNG multipart upload
        ↓
final https://vikingfile.com/f/... URL
```

The worker currently uses WebTorrent's disk-backed chunk store as a temporary cache, but it starts uploading each ViKiNG multipart range as soon as the required torrent pieces become available. It does not wait for the complete selected file before starting the destination upload.

This makes the first production target a small VM with sufficient temporary disk (for example an Oracle Cloud VM). A future bounded/ring chunk store can remove the full-cache disk requirement.

Use only for content you are authorized to download and redistribute.

## Requirements

- Node.js 22+
- outbound TCP/UDP access for BitTorrent
- outbound HTTPS access to ViKiNG
- temporary working disk

No Real-Debrid or ViKiNG account is required for anonymous ViKiNG uploads.

## CLI

Install:

```bash
npm install
```

Official legal test torrent (Sintel / WebTorrent):

```bash
npm run transfer -- --sintel
```

Arbitrary authorized torrent:

```bash
npm run transfer -- --source 'magnet:?xt=...' --file largest
```

`--file` accepts `largest`, a zero-based file index, an exact file path, or an exact filename.

## HTTP job API

Start:

```bash
npm start
```

Create a job:

```http
POST /jobs
Content-Type: application/json

{
  "source": "magnet:?xt=...",
  "file": "largest"
}
```

Poll:

```http
GET /jobs/<job-id>
```

Statuses/stages include metadata, destination initialization, streaming, finalizing, verifying, complete, and failed. Progress includes multipart part number, uploaded bytes, torrent-downloaded bytes, and peer count.

Only one transfer runs at a time in this prototype.

## Docker / VM

```bash
docker build -t gameaccess-torrent-worker .
docker run --rm -p 8787:8787 -v /srv/gameaccess-torrents:/data/jobs gameaccess-torrent-worker
```

On an Oracle VM, mount a sufficiently large block volume at `/srv/gameaccess-torrents` and put the service behind HTTPS/reverse proxy before exposing it publicly.

## Security before public deployment

The prototype API intentionally stays small. Before exposing it on the Internet add:

- API authentication;
- per-user/job quotas;
- source allow/deny policy and abuse controls;
- maximum torrent/file size;
- timeout and disk free-space checks;
- job persistence (SQLite is sufficient initially);
- automatic cleanup of abandoned jobs;
- HTTPS;
- rate limits.

## CI smoke test

The repository workflow `torrent-transfer-worker.yml` runs unit tests and can run a legal Sintel end-to-end smoke test. GitHub Actions is used only as development/CI validation, not as the production transfer service.
