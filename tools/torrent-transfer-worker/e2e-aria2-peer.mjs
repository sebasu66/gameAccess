import WebTorrent from 'webtorrent'
import crypto from 'node:crypto'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { transferTorrentToViking } from './src/transfer.mjs'

const temp = await mkdtemp(path.join(os.tmpdir(), 'gameaccess-aria2-e2e-'))
const payloadPath = path.join(temp, 'gameaccess-mainline-smoke.bin')
const torrentPath = path.join(temp, 'gameaccess-mainline-smoke.torrent')
const downloadDir = path.join(temp, 'worker-download')
const size = 5 * 1024 * 1024
const payload = Buffer.allocUnsafe(size)
for (let i = 0; i < payload.length; i += 1) payload[i] = i % 251
await writeFile(payloadPath, payload)
const expectedSha256 = crypto.createHash('sha256').update(payload).digest('hex')
const port = 43210

function createTorrentFile() {
  const maker = new WebTorrent({ dht: false, tracker: false, lsd: false, natUpnp: false, natPmp: false })
  return new Promise((resolve, reject) => {
    maker.once('error', reject)
    maker.seed(payloadPath, { announce: [] }, async torrent => {
      try {
        const torrentFile = Buffer.from(torrent.torrentFile)
        await writeFile(torrentPath, torrentFile)
        resolve({ torrentFile, maker })
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function waitForPort(host, targetPort, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await new Promise(resolve => {
      const socket = net.connect({ host, port: targetPort })
      socket.setTimeout(1000)
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('timeout', () => { socket.destroy(); resolve(false) })
      socket.once('error', () => resolve(false))
    })
    if (ok) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`aria2 did not open BitTorrent TCP port ${targetPort}.`)
}

let aria2
let maker
try {
  const generated = await createTorrentFile()
  maker = generated.maker
  await new Promise(resolve => maker.destroy(() => resolve()))
  maker = null

  aria2 = spawn('aria2c', [
    '--console-log-level=notice',
    '--summary-interval=0',
    '--enable-dht=false',
    '--enable-dht6=false',
    '--bt-enable-lpd=false',
    '--enable-peer-exchange=false',
    '--bt-seed-unverified=true',
    '--seed-ratio=0.0',
    '--seed-time=60',
    `--listen-port=${port}`,
    `--dht-listen-port=${port + 1}`,
    `--dir=${temp}`,
    torrentPath
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  aria2.stdout.on('data', chunk => console.error(`[aria2] ${chunk.toString().trimEnd()}`))
  aria2.stderr.on('data', chunk => console.error(`[aria2 err] ${chunk.toString().trimEnd()}`))
  aria2.once('exit', code => {
    if (code && code !== 0) console.error(`[aria2] exited early with code ${code}`)
  })

  await waitForPort('127.0.0.1', port)
  const events = []
  const result = await transferTorrentToViking({
    source: generated.torrentFile,
    selector: 'largest',
    peers: [`127.0.0.1:${port}`],
    workDir: downloadDir,
    timeoutMs: 5 * 60 * 1000,
    onStatus: event => {
      events.push(event)
      console.error(`[${event.stage}] ${event.message}`)
    }
  })

  const maxPeers = Math.max(0, ...events.map(event => Number(event.peers || 0)))
  const maxTorrentDownloadedBytes = Math.max(0, ...events.map(event => Number(event.torrentDownloadedBytes || 0)))
  if (result.status !== 'complete' || result.verified !== true) throw new Error('Final ViKiNG result was not complete and verified.')
  if (result.bytes !== size) throw new Error(`Transferred ${result.bytes} bytes; expected ${size}.`)
  if (maxPeers < 1) throw new Error('No mainline BitTorrent peer was observed.')

  console.log(JSON.stringify({
    ...result,
    protocolTest: 'WebTorrent leecher <- aria2 mainline BitTorrent seeder -> ViKiNG',
    injectedPeer: `127.0.0.1:${port}`,
    expectedSha256,
    testBytes: size,
    maxPeers,
    maxTorrentDownloadedBytes
  }, null, 2))
} finally {
  if (aria2 && aria2.exitCode == null) {
    aria2.kill('SIGTERM')
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000)
      aria2.once('exit', () => { clearTimeout(timer); resolve() })
    }).catch(() => {})
  }
  if (maker) await new Promise(resolve => maker.destroy(() => resolve())).catch(() => {})
  await rm(temp, { recursive: true, force: true }).catch(() => {})
}
