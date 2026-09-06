import WebTorrent from 'webtorrent'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import os from 'node:os'
import { createMultipartUpload, uploadPart, completeMultipartUpload, verifyFile } from './viking.mjs'

export const SINTEL_TORRENT_URL = 'https://webtorrent.io/torrents/sintel.torrent'

export function humanBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = Number(value)
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(1)} ${units[i]}`
}

export function chooseFile(files, selector = 'largest') {
  if (!Array.isArray(files) || files.length === 0) throw new Error('Torrent contains no files.')
  if (selector === 'largest') {
    return [...files].sort((a, b) => Number(b.length) - Number(a.length))[0]
  }
  if (/^\d+$/.test(String(selector))) {
    const index = Number(selector)
    if (!files[index]) throw new Error(`Torrent file index ${index} does not exist.`)
    return files[index]
  }
  const exact = files.find(file => file.path === selector || file.name === selector)
  if (!exact) throw new Error(`Torrent file not found: ${selector}`)
  return exact
}

function waitForMetadata(client, torrentId, opts) {
  return new Promise((resolve, reject) => {
    const torrent = client.add(torrentId, opts, resolve)
    const fail = error => reject(error)
    torrent.once('error', fail)
    client.once('error', fail)
  })
}

async function spoolTorrentRangeToFile(file, start, end, destination) {
  await pipeline(
    file.createReadStream({ start, end }),
    createWriteStream(destination)
  )
}

export async function transferTorrentToViking({
  source,
  selector = 'largest',
  peers = [],
  workDir = process.env.WORK_DIR || path.join(os.tmpdir(), 'gameaccess-torrent-worker'),
  vikingUser = process.env.VIKING_USER_HASH || '',
  onStatus = () => {},
  timeoutMs = 6 * 60 * 60 * 1000
}) {
  if (!source) throw new Error('Torrent source is required.')
  await mkdir(workDir, { recursive: true })

  const client = new WebTorrent({ uploadLimit: 0 })
  let torrent
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Transfer timed out after ${Math.round(timeoutMs / 60000)} minutes.`)), timeoutMs)
    timer.unref?.()
  })

  const execute = async () => {
    onStatus({ stage: 'metadata', message: 'Resolving torrent metadata…' })
    torrent = await waitForMetadata(client, source, {
      path: workDir,
      deselect: true,
      destroyStoreOnDestroy: true,
      addUID: true,
      strategy: 'sequential'
    })

    for (const peer of peers) torrent.addPeer(peer)
    for (const item of torrent.files) item.deselect()
    const file = chooseFile(torrent.files, selector)
    file.select(10)

    onStatus({
      stage: 'metadata',
      message: `Selected ${file.path} (${humanBytes(file.length)})`,
      infoHash: torrent.infoHash,
      filename: file.name,
      bytes: file.length,
      files: torrent.files.map((item, index) => ({ index, path: item.path, bytes: item.length }))
    })

    onStatus({ stage: 'destination_init', message: 'Creating anonymous ViKiNG multipart upload…' })
    const upload = await createMultipartUpload(file.length)
    const expectedParts = Math.ceil(file.length / upload.partSize)
    if (upload.urls.length < expectedParts) {
      throw new Error(`ViKiNG returned ${upload.urls.length} part URLs but ${expectedParts} are required.`)
    }

    const parts = []
    let uploadedBytes = 0

    for (let index = 0; index < expectedParts; index += 1) {
      const start = index * upload.partSize
      const end = Math.min(file.length - 1, start + upload.partSize - 1)
      const length = end - start + 1
      const partNumber = index + 1
      const partPath = path.join(workDir, `viking-part-${torrent.infoHash}-${partNumber}.bin`)

      onStatus({
        stage: 'buffering_part',
        message: `Fetching torrent part ${partNumber}/${expectedParts} into temporary buffer (${humanBytes(length)})…`,
        part: partNumber,
        parts: expectedParts,
        uploadedBytes,
        totalBytes: file.length,
        torrentDownloadedBytes: file.downloaded,
        peers: torrent.numPeers
      })

      try {
        await spoolTorrentRangeToFile(file, start, end, partPath)

        onStatus({
          stage: 'uploading_part',
          message: `Uploading buffered part ${partNumber}/${expectedParts} to ViKiNG…`,
          part: partNumber,
          parts: expectedParts,
          uploadedBytes,
          totalBytes: file.length,
          torrentDownloadedBytes: file.downloaded,
          peers: torrent.numPeers
        })

        const etag = await uploadPart(upload.urls[index], createReadStream(partPath), length)
        uploadedBytes += length
        parts.push({ PartNumber: partNumber, ETag: etag })
      } finally {
        await rm(partPath, { force: true }).catch(() => {})
      }

      onStatus({
        stage: 'streaming',
        message: `Uploaded part ${partNumber}/${expectedParts}.`,
        part: partNumber,
        parts: expectedParts,
        uploadedBytes,
        totalBytes: file.length,
        progress: uploadedBytes / file.length,
        torrentDownloadedBytes: file.downloaded,
        peers: torrent.numPeers
      })
    }

    onStatus({ stage: 'finalizing', message: 'Finalizing ViKiNG multipart upload…', progress: 1 })
    const completed = await completeMultipartUpload({
      key: upload.key,
      uploadId: upload.uploadId,
      parts,
      name: file.name,
      user: vikingUser
    })

    onStatus({ stage: 'verifying', message: `Verifying ${completed.url}…`, progress: 1 })
    const verification = await verifyFile(completed.hash)

    const result = {
      status: 'complete',
      source: typeof source === 'string' ? source : 'torrent-file-buffer',
      infoHash: torrent.infoHash,
      filename: file.name,
      bytes: file.length,
      destination: 'ViKiNG FiLE',
      url: completed.url,
      hash: completed.hash,
      verified: verification.exist === true,
      cacheMode: 'disk-backed WebTorrent chunk store plus one temporary ViKiNG multipart buffer at a time'
    }
    onStatus({ stage: 'complete', message: `Transfer complete: ${completed.url}`, progress: 1, result })
    return result
  }

  try {
    return await Promise.race([execute(), timeout])
  } finally {
    if (torrent) {
      try { await client.remove(torrent.infoHash, { destroyStore: true }) } catch {}
    }
    try { client.destroy() } catch {}
  }
}
