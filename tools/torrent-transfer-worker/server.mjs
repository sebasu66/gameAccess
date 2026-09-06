import http from 'node:http'
import crypto from 'node:crypto'
import { transferTorrentToViking } from './src/transfer.mjs'

const port = Number(process.env.PORT || 8787)
const jobs = new Map()
let activeJobId = null

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body, null, 2))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store'
  })
  res.end(data)
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request body too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(new Error('Invalid JSON body.')) }
    })
    req.on('error', reject)
  })
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    details: job.details,
    result: job.result,
    error: job.error
  }
}

async function startJob(job) {
  activeJobId = job.id
  try {
    job.status = 'running'
    job.updatedAt = new Date().toISOString()
    job.result = await transferTorrentToViking({
      source: job.source,
      selector: job.selector,
      onStatus: event => {
        job.stage = event.stage
        job.message = event.message
        job.updatedAt = new Date().toISOString()
        if (event.progress != null) job.progress = event.progress
        job.details = {
          peers: event.peers,
          part: event.part,
          parts: event.parts,
          uploadedBytes: event.uploadedBytes,
          totalBytes: event.totalBytes,
          torrentDownloadedBytes: event.torrentDownloadedBytes,
          filename: event.filename,
          bytes: event.bytes,
          files: event.files
        }
      }
    })
    job.status = 'complete'
    job.stage = 'complete'
    job.progress = 1
  } catch (error) {
    job.status = 'failed'
    job.stage = 'failed'
    job.error = `${error?.name || 'Error'}: ${error?.message || error}`
  } finally {
    job.updatedAt = new Date().toISOString()
    activeJobId = null
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, activeJobId, jobs: jobs.size })
    }

    if (req.method === 'POST' && url.pathname === '/jobs') {
      if (activeJobId) return json(res, 409, { error: 'A transfer is already running.', activeJobId })
      const body = await readJson(req)
      const source = String(body.source || '').trim()
      const selector = String(body.file || 'largest').trim()
      if (!source || !(source.startsWith('magnet:?') || /^https?:\/\//i.test(source))) {
        return json(res, 400, { error: 'source must be a magnet URI or HTTP(S) .torrent URL.' })
      }
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const job = {
        id,
        source,
        selector,
        status: 'queued',
        stage: 'queued',
        message: 'Queued',
        progress: 0,
        createdAt: now,
        updatedAt: now,
        details: {},
        result: null,
        error: null
      }
      jobs.set(id, job)
      void startJob(job)
      return json(res, 202, publicJob(job))
    }

    const match = url.pathname.match(/^\/jobs\/([0-9a-f-]+)$/i)
    if (req.method === 'GET' && match) {
      const job = jobs.get(match[1])
      return job ? json(res, 200, publicJob(job)) : json(res, 404, { error: 'Job not found.' })
    }

    return json(res, 404, { error: 'Not found.' })
  } catch (error) {
    return json(res, 500, { error: `${error?.name || 'Error'}: ${error?.message || error}` })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`GameAccess torrent transfer worker listening on :${port}`)
})
