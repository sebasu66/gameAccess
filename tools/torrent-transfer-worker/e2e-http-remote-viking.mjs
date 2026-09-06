import WebTorrent from 'webtorrent'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { remoteUploadFromUrl, verifyFile } from './src/viking.mjs'

const SINTEL = 'https://webtorrent.io/torrents/sintel.torrent'
const workDir = await mkdtemp(path.join(os.tmpdir(), 'gameaccess-http-remote-'))
const cloudflaredBin = process.env.CLOUDFLARED_BIN || 'cloudflared'
const client = new WebTorrent({ uploadLimit: -1 })
const serverInstance = client.createServer({}, 'node')
let cloudflared
let torrent

function waitForTorrent(source) {
  return new Promise((resolve, reject) => {
    const t = client.add(source, {
      path: workDir,
      destroyStoreOnDestroy: true,
      strategy: 'sequential'
    }, resolve)
    t.once('error', reject)
    client.once('error', reject)
  })
}

function waitForTunnel(proc, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`cloudflared did not produce a public URL. Output: ${output.slice(-2000)}`)), timeoutMs)
    const consume = chunk => {
      const text = chunk.toString()
      output += text
      process.stderr.write(`[cloudflared] ${text}`)
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
      if (match) {
        clearTimeout(timer)
        resolve(match[0])
      }
    }
    proc.stdout.on('data', consume)
    proc.stderr.on('data', consume)
    proc.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`cloudflared exited before tunnel was ready (code ${code}). Output: ${output.slice(-2000)}`))
    })
  })
}

async function fetchRange(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  let attempt = 0
  while (Date.now() < deadline) {
    attempt += 1
    try {
      const response = await fetch(url, { headers: { range: 'bytes=0-1023' } })
      if ([200, 206].includes(response.status)) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength < 1) throw new Error('Public WebTorrent URL returned no bytes.')
        return { status: response.status, bytes: bytes.byteLength, contentRange: response.headers.get('content-range'), attempts: attempt }
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    console.error(`[probe] tunnel not reachable yet (attempt ${attempt}): ${lastError?.cause?.code || lastError?.code || lastError?.message || lastError}`)
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  throw new Error(`Public WebTorrent URL did not become reachable within ${timeoutMs / 1000}s: ${lastError?.cause?.code || lastError?.code || lastError?.message || lastError}`)
}

try {
  serverInstance.server.listen(0, '127.0.0.1')
  await once(serverInstance.server, 'listening')
  const port = serverInstance.server.address().port
  console.error(`[server] WebTorrent HTTP server listening on 127.0.0.1:${port}`)

  torrent = await waitForTorrent(SINTEL)
  const file = torrent.files.find(item => item.name.toLowerCase().endsWith('.mp4')) || torrent.files.sort((a, b) => b.length - a.length)[0]
  file.select(10)
  console.error(`[torrent] ${torrent.infoHash} selected ${file.path} (${file.length} bytes)`)

  const localFileUrl = new URL(file.streamURL, `http://127.0.0.1:${port}`)
  console.error(`[server] local stream URL ${localFileUrl.href}`)

  cloudflared = spawn(cloudflaredBin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--loglevel', 'info'], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const tunnelBase = await waitForTunnel(cloudflared)
  const publicFileUrl = new URL(`${localFileUrl.pathname}${localFileUrl.search}`, tunnelBase).href
  console.error(`[tunnel] public WebTorrent stream ${publicFileUrl}`)

  const rangeProbe = await fetchRange(publicFileUrl)
  console.error(`[probe] HTTP ${rangeProbe.status}, ${rangeProbe.bytes} bytes, content-range=${rangeProbe.contentRange || 'none'}, attempts=${rangeProbe.attempts}`)

  console.error('[viking] submitting public WebTorrent stream URL as remote upload…')
  const uploaded = await remoteUploadFromUrl(publicFileUrl, { name: `webtorrent-stream-${file.name}` })
  const verified = await verifyFile(uploaded.hash)

  if (Number(uploaded.size) !== Number(file.length)) {
    throw new Error(`ViKiNG size mismatch: got ${uploaded.size}, expected ${file.length}`)
  }

  console.log(JSON.stringify({
    status: 'complete',
    architecture: 'BitTorrent/WebTorrent createServer -> Cloudflare Quick Tunnel -> ViKiNG remote URL upload',
    sourceTorrent: SINTEL,
    infoHash: torrent.infoHash,
    sourceFile: file.path,
    sourceBytes: file.length,
    rangeProbe,
    destinationUrl: uploaded.url,
    destinationHash: uploaded.hash,
    destinationBytes: Number(uploaded.size),
    verified: verified.exist === true
  }, null, 2))
} finally {
  if (cloudflared && cloudflared.exitCode == null) cloudflared.kill('SIGTERM')
  try { serverInstance.close() } catch {}
  if (torrent) {
    try { await client.remove(torrent.infoHash, { destroyStore: true }) } catch {}
  }
  try { client.destroy() } catch {}
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
}
