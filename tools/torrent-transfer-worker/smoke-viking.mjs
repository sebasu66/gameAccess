import { Readable } from 'node:stream'
import { createMultipartUpload, uploadPart, completeMultipartUpload, verifyFile } from './src/viking.mjs'

const size = 1024 * 1024
const data = Buffer.alloc(size, 0x47)
const upload = await createMultipartUpload(size)
if (upload.urls.length < 1) throw new Error('ViKiNG returned no part URL.')
const etag = await uploadPart(upload.urls[0], Readable.from(data), size)
const result = await completeMultipartUpload({
  key: upload.key,
  uploadId: upload.uploadId,
  parts: [{ PartNumber: 1, ETag: etag }],
  name: 'gameaccess-viking-smoke.bin',
  user: ''
})
const verified = await verifyFile(result.hash)
console.log(JSON.stringify({ status: 'complete', url: result.url, hash: result.hash, verified: verified.exist === true, bytes: size }, null, 2))
