import WebTorrent from 'webtorrent'
import crypto from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { transferTorrentToViking } from './src/transfer.mjs'

const temp = await mkdtemp(path.join(os.tmpdir(), 'gameaccess-p2p-e2e-'))
const seedPath = path.join(temp, 'gameaccess-p2p-smoke.bin')
const downloadDir = path.join(temp, 'download')
const size = 5 * 1024 * 1024
const data = Buffer.allocUnsafe(size)
for (let index = 0; index < data.length; index += 1) data[index] = index % 251
await writeFile(seedPath, data)
const expectedSha256 = crypto.createHash('sha256').update(data).digest('hex')

const seeder = new WebTorrent({
  dht: false,
  tracker: false,
  lsd: false,
  natUpnp: false,
  natPmp: false,
  uploadLimit: -1
})

function seedFile() {
  return new Promise((resolve, reject) => {
    const onError = error => reject(error)
    seeder.once('error', onError)
    seeder.seed(seedPath, { announce: [] }, torrent => {
      seeder.off('error', onError)
      resolve(torrent)
    })
  })
}

try {
  const seeded = await seedFile()
  const port = Number(seeder.torrentPort || seeded?.client?.torrentPort || 0)
  if (!port) throw new Error('WebTorrent seeder did not expose a listening torrentPort.')

  const peer = `127.0.0.1:${port}`
  const events = []
  const result = await transferTorrentToViking({
    source: seeded.torrentFile,
    selector: 'largest',
    peers: [peer],
    workDir: downloadDir,
    timeoutMs: 10 * 60 * 1000,
    onStatus: event => {
      events.push(event)
      console.error(`[${event.stage}] ${event.message}`)
    }
  })

  const sawPeer = events.some(event => Number(event.peers || 0) > 0)
  if (!sawPeer) throw new Error('Transfer completed without observing the injected BitTorrent peer.')
  if (result.bytes !== size) throw new Error(`Unexpected transferred size: ${result.bytes}, expected ${size}.`)
  if (result.verified !== true) throw new Error('ViKiNG final file verification did not succeed.')

  console.log(JSON.stringify({
    ...result,
    peer,
    expectedSha256,
    testBytes: size,
    sawPeer,
    deterministicPeerTest: true
  }, null, 2))
} finally {
  await new Promise(resolve => seeder.destroy(() => resolve())).catch(() => {})
  await rm(temp, { recursive: true, force: true }).catch(() => {})
}
