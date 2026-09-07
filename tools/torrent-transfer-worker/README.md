# GameAccess torrent transfer worker (no premium account)

Prototype worker for transferring an authorized torrent directly into ViKiNG FiLE without Real-Debrid, Seedr, or another premium torrent service.

## Architecture

```text
magnet / local .torrent / .torrent URL
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

Run with a magnet:

```bash
npm run transfer -- --source 'magnet:?xt=...' --file largest
```

Run with a local `.torrent`:

```bash
npm run transfer -- --source 'C:/path/file.torrent' --file largest
```

Run with an HTTP/HTTPS `.torrent` URL:

```bash
npm run transfer -- --source 'https://example.com/file.torrent' --file largest
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

Before exposing the worker publicly, add authentication, quotas, source/size controls, timeout and disk checks, persistence, cleanup, HTTPS, and rate limits.

## CI

The repository workflow `torrent-transfer-worker.yml` runs generic unit and transfer-path smoke tests. The production/user flow has no hard-coded torrent fixture.
