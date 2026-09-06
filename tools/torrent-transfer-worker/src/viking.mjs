const API_BASE = 'https://vikingfile.com/api'

export class VikingError extends Error {}

function formBody(values) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    body.set(key, String(value))
  }
  return body
}

async function expectJson(response, label) {
  const text = await response.text()
  if (!response.ok) {
    throw new VikingError(`${label} failed with HTTP ${response.status}: ${text.slice(0, 500)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new VikingError(`${label} returned invalid JSON: ${text.slice(0, 500)}`)
  }
}

export async function createMultipartUpload(size) {
  const response = await fetch(`${API_BASE}/get-upload-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ size })
  })
  const data = await expectJson(response, 'ViKiNG create multipart upload')
  if (!data.uploadId || !data.key || !Array.isArray(data.urls) || !data.partSize) {
    throw new VikingError(`ViKiNG returned incomplete multipart metadata: ${JSON.stringify(data)}`)
  }
  return data
}

export async function uploadPart(url, stream, length) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-length': String(length) },
    body: stream,
    duplex: 'half'
  })
  if (!response.ok) {
    const text = await response.text()
    throw new VikingError(`ViKiNG part upload failed with HTTP ${response.status}: ${text.slice(0, 500)}`)
  }
  const etag = response.headers.get('etag')
  if (!etag) {
    throw new VikingError('ViKiNG part upload succeeded but no ETag header was returned.')
  }
  return etag
}

export async function completeMultipartUpload({ key, uploadId, parts, name, user = '' }) {
  const body = new URLSearchParams()
  body.set('key', key)
  body.set('uploadId', uploadId)
  body.set('name', name)
  body.set('user', user)
  parts.forEach((part, index) => {
    body.set(`parts[${index}][PartNumber]`, String(part.PartNumber))
    body.set(`parts[${index}][ETag]`, part.ETag)
  })

  const response = await fetch(`${API_BASE}/complete-upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
  const data = await expectJson(response, 'ViKiNG complete multipart upload')
  if (!data.url || !data.hash) {
    throw new VikingError(`ViKiNG did not return a final file URL/hash: ${JSON.stringify(data)}`)
  }
  return data
}

export async function verifyFile(hash) {
  const response = await fetch(`${API_BASE}/check-file`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ hash })
  })
  const data = await expectJson(response, 'ViKiNG verify file')
  if (data.exist !== true) {
    throw new VikingError(`ViKiNG verification says the uploaded file is missing: ${JSON.stringify(data)}`)
  }
  return data
}
