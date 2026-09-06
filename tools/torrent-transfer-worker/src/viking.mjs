import https from 'node:https'

const API_BASE = 'https://vikingfile.com/api'

export class VikingError extends Error {}

function formBody(values) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) body.set(key, String(value))
  return body
}

async function expectJson(response, label) {
  const text = await response.text()
  if (!response.ok) throw new VikingError(`${label} failed with HTTP ${response.status}: ${text.slice(0, 500)}`)
  try { return JSON.parse(text) } catch { throw new VikingError(`${label} returned invalid JSON: ${text.slice(0, 500)}`) }
}

function parseJsonLines(text) {
  const trimmed = text.trim()
  if (!trimmed) return []
  try { return [JSON.parse(trimmed)] } catch {}
  const parsed = []
  for (const line of trimmed.split(/\r?\n/)) {
    const value = line.trim()
    if (!value) continue
    try { parsed.push(JSON.parse(value)) } catch {}
  }
  return parsed
}

export async function createMultipartUpload(size) {
  const response = await fetch(`${API_BASE}/get-upload-url`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: formBody({ size })
  })
  const data = await expectJson(response, 'ViKiNG create multipart upload')
  if (!data.uploadId || !data.key || !Array.isArray(data.urls) || !data.partSize) {
    throw new VikingError(`ViKiNG returned incomplete multipart metadata: ${JSON.stringify(data)}`)
  }
  return data
}

export async function uploadPart(url, stream, length) {
  const target = new URL(url)
  return await new Promise((resolve, reject) => {
    const request = https.request({
      protocol: target.protocol, hostname: target.hostname, port: target.port || 443,
      path: `${target.pathname}${target.search}`, method: 'PUT',
      headers: { 'content-length': String(length), 'content-type': 'application/octet-stream' }
    }, response => {
      const chunks = []
      let captured = 0
      response.on('data', chunk => { if (captured < 8192) { chunks.push(chunk); captured += chunk.length } })
      response.on('end', () => {
        const status = response.statusCode || 0
        const text = Buffer.concat(chunks).toString('utf8').slice(0, 500)
        if (status < 200 || status >= 300) return reject(new VikingError(`ViKiNG part upload failed with HTTP ${status}: ${text}`))
        const etag = response.headers.etag
        if (!etag) return reject(new VikingError('ViKiNG part upload succeeded but no ETag header was returned.'))
        resolve(etag)
      })
    })
    request.setTimeout(30 * 60 * 1000, () => request.destroy(new VikingError('ViKiNG part upload timed out.')))
    request.on('error', error => reject(new VikingError(`ViKiNG part upload network failure: ${error?.code || error?.name || 'Error'}: ${error?.message || error}`)))
    stream.on('error', error => request.destroy(new VikingError(`Source stream failed during ViKiNG upload: ${error?.message || error}`)))
    stream.pipe(request)
  })
}

export async function completeMultipartUpload({ key, uploadId, parts, name, user = '' }) {
  const body = new URLSearchParams()
  body.set('key', key); body.set('uploadId', uploadId); body.set('name', name); body.set('user', user)
  parts.forEach((part, index) => {
    body.set(`parts[${index}][PartNumber]`, String(part.PartNumber))
    body.set(`parts[${index}][ETag]`, part.ETag)
  })
  const response = await fetch(`${API_BASE}/complete-upload`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
  })
  const data = await expectJson(response, 'ViKiNG complete multipart upload')
  if (!data.url || !data.hash) throw new VikingError(`ViKiNG did not return a final file URL/hash: ${JSON.stringify(data)}`)
  return data
}

export async function remoteUploadFromUrl(link, { name = '', user = '', onProgress = () => {} } = {}) {
  const serverResponse = await fetch(`${API_BASE}/get-server`)
  const serverData = await expectJson(serverResponse, 'ViKiNG get remote upload server')
  const server = String(serverData?.server || '').trim()
  if (!server.startsWith('http')) throw new VikingError(`ViKiNG returned invalid remote upload server: ${JSON.stringify(serverData)}`)

  const response = await fetch(server, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ link, user, name })
  })
  const text = await response.text()
  if (!response.ok) throw new VikingError(`ViKiNG remote URL upload failed with HTTP ${response.status}: ${text.slice(0, 1000)}`)

  const events = parseJsonLines(text)
  for (const event of events) {
    if (event && typeof event === 'object' && event.progress != null) onProgress(event)
  }
  const final = [...events].reverse().find(event => event && typeof event === 'object' && event.url && event.hash)
  if (!final) {
    const tail = text.slice(-2000)
    throw new VikingError(`ViKiNG remote URL upload returned progress but no final URL/hash. Response tail: ${tail}`)
  }
  return final
}

export async function verifyFile(hash) {
  const response = await fetch(`${API_BASE}/check-file`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: formBody({ hash })
  })
  const data = await expectJson(response, 'ViKiNG verify file')
  const item = Array.isArray(data) ? data.find(entry => entry?.hash === hash) || data[0] : data
  if (!item || item.exist !== true) throw new VikingError(`ViKiNG verification says the uploaded file is missing: ${JSON.stringify(data)}`)
  return item
}
