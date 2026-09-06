import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseFile, humanBytes, SINTEL_TORRENT_URL } from '../src/transfer.mjs'

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

test('Sintel source is the official WebTorrent test torrent', () => {
  assert.equal(SINTEL_TORRENT_URL, 'https://webtorrent.io/torrents/sintel.torrent')
})
