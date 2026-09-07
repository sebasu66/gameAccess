import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { chooseFile, humanBytes, normalizeParallelParts, resolveTorrentSource } from '../src/transfer.mjs'

test('chooseFile selects largest file', () => {
  const files = [
    { name: 'readme.txt', path: 'readme.txt', length: 100 },
    { name: 'movie.mp4', path: 'video/movie.mp4', length: 5000 },
    { name: 'poster.jpg', path: 'poster.jpg', length: 300 }
  ]
  assert.equal(chooseFile(files, 'largest').name, 'movie.mp4')
})

test('chooseFile accepts index and path', () => {
  const files = [
    { name: 'a.txt', path: 'dir/a.txt', length: 10 },
    { name: 'b.txt', path: 'dir/b.txt', length: 20 }
  ]
  assert.equal(chooseFile(files, '1').name, 'b.txt')
  assert.equal(chooseFile(files, 'dir/a.txt').name, 'a.txt')
})

test('chooseFile rejects unknown file', () => {
  assert.throws(() => chooseFile([{ name: 'a', path: 'a', length: 1 }], 'missing'), /not found/i)
})

test('humanBytes formats sizes', () => {
  assert.equal(humanBytes(1024), '1.0 KB')
  assert.equal(humanBytes(1024 ** 3), '1.0 GB')
})

test('parallel part count is limited to 1 through 10', () => {
  assert.equal(normalizeParallelParts(1), 1)
  assert.equal(normalizeParallelParts(6), 6)
  assert.equal(normalizeParallelParts(10), 10)
  assert.equal(normalizeParallelParts(0), 1)
  assert.equal(normalizeParallelParts(99), 10)
  assert.equal(normalizeParallelParts('bad'), 1)
})

test('resolveTorrentSource reads local .torrent metadata into a Buffer', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ga-torrent-test-'))
  const torrentPath = path.join(dir, 'sample.torrent')
  const expected = Buffer.from('d4:infode')
  try {
    await writeFile(torrentPath, expected)
    const resolved = await resolveTorrentSource(torrentPath)
    assert.ok(Buffer.isBuffer(resolved))
    assert.deepEqual(resolved, expected)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('resolveTorrentSource leaves magnets unchanged', async () => {
  const magnet = 'magnet:?xt=urn:btih:0123456789abcdef'
  assert.equal(await resolveTorrentSource(magnet), magnet)
})

test('resolveTorrentSource rejects HTTP torrent URLs instead of prefetching metadata', async () => {
  await assert.rejects(
    () => resolveTorrentSource('https://example.test/file.torrent'),
    /HTTP \.torrent URLs are not used/i
  )
})
