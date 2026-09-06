import WebTorrent from 'webtorrent'
import crypto from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const temp = await mkdtemp(path.join(os.tmpdir(), 'gameaccess-peer-smoke-'))
const sourcePath = path.join(temp, 'source.bin')
const destinationPath = path.join(temp, 'downloaded.bin')
const data = Buffer.allocUnsafe(1024 * 1024)
for (let i = 0; i < data.length; i += 1) data[i] = i % 251
await writeFile(sourcePath, data)
const expectedSha256 = crypto.createHash('sha256').update(data).digest('hex')

const seedPort = 41000 + Math.floor(Math.random() * 1000)
const downloadPort = seedPort + 1000
const seeder = new WebTorrent({ dht: false, lsd: false, natUpnp: false, natPmp: false, utp: false, torrentPort: seedPort, uploadLimit: -1 })
const leecher = new WebTorrent({ dht: false, lsd: false, natUpnp: false, natPmp: false, utp: false, torrentPort: downloadPort, uploadLimit: 0 })

const timeout = new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error('Local BitTorrent peer smoke timed out after 45 seconds.')), 45_000)
  timer.unref?.()
})

function seed() {
  return new Promise((resolve, reject) => {
    seeder.once('error', reject)
    seeder.seed(sourcePath, { announce: [] }, torrent => resolve(torrent))
  })
}

function add(torrentFile) {
  return new Promise((resolve, reject) => {
    leecher.once('error', reject)
    const torrent = leecher.add(torrentFile, { announce: [], deselect: true, path: path.join(temp, 'store') }, resolve)
    torrent.on('warning', warning => console.error(`[leecher warning] ${warning.message}`))
    torrent.on('wire', (_wire, addr) => console.error(`[wire] ${addr}`))
    torrent.on('download', bytes => console.error(`[download] +${bytes} total=${torrent.downloaded}`))
  })
}

try {
  const seeded = await seed()
  console.error(`[seed] infoHash=${seeded.infoHash} configuredPort=${seedPort} clientPort=${seeder.torrentPort}`)
  const torrent = await add(seeded.torrentFile)
  const peer = `127.0.0.1:${seedPort}`
  const added = torrent.addPeer(peer)
  console.error(`[peer] ${peer} added=${added}`)
  if (!added) throw new Error('WebTorrent rejected the explicit localhost peer.')
  const file = torrent.files[0]
  const copy = pipeline(file.createReadStream(), createWriteStream(destinationPath))
  await Promise.race([copy, timeout])
  const downloaded = await readFile(destinationPath)
  const actualSha256 = crypto.createHash('sha256').update(downloaded).digest('hex')
  if (actualSha256 !== expectedSha256) throw new Error(`Hash mismatch: ${actualSha256} != ${expectedSha256}`)
  console.log(JSON.stringify({
    status: 'complete',
    protocol: 'BitTorrent TCP localhost peer',
    bytes: downloaded.length,
    peer,
    expectedSha256,
    actualSha256,
    observedPeers: torrent.numPeers
  }, null, 2))
} finally {
  await new Promise(resolve => leecher.destroy(() => resolve())).catch(() => {})
  await new Promise(resolve => seeder.destroy(() => resolve())).catch(() => {})
  await rm(temp, { recursive: true, force: true }).catch(() => {})
}
