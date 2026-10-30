'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { readSoleFile } = require('../src/zip.js')
const { zip } = require('./fixtures/zip.js')

const BREAKDOWN = 'internal/tariff/rate.go;12;9\ninternal/tariff/zone.go;30;30\n'

test('a deflated breakdown file is read back byte for byte', () => {
  const { name, data } = readSoleFile(zip([{ name: 'coverage-breakdown.txt', content: BREAKDOWN }]))
  assert.strictEqual(name, 'coverage-breakdown.txt')
  assert.strictEqual(data.toString('utf8'), BREAKDOWN)
})

test('a stored entry is read without inflating', () => {
  const { data } = readSoleFile(zip([{ name: 'coverage-breakdown.txt', content: BREAKDOWN }], { method: 0 }))
  assert.strictEqual(data.toString('utf8'), BREAKDOWN)
})

// Artifact archives are written as a stream, so the local header carries no sizes.
test('a streamed archive is read from the central directory sizes', () => {
  const { data } = readSoleFile(zip([{ name: 'coverage-breakdown.txt', content: BREAKDOWN }], { streamed: true }))
  assert.strictEqual(data.toString('utf8'), BREAKDOWN)
})

test('an archive comment does not hide the directory', () => {
  const { data } = readSoleFile(zip([{ name: 'b.txt', content: BREAKDOWN }], { comment: 'x'.repeat(300) }))
  assert.strictEqual(data.toString('utf8'), BREAKDOWN)
})

test('directory entries are not counted as files', () => {
  const { name } = readSoleFile(
    zip([
      { name: 'nested/', content: '' },
      { name: 'nested/coverage-breakdown.txt', content: BREAKDOWN },
    ]),
  )
  assert.strictEqual(name, 'nested/coverage-breakdown.txt')
})

test('an archive with more than one file is refused', () => {
  const buf = zip([
    { name: 'a.txt', content: 'a' },
    { name: 'b.txt', content: 'b' },
  ])
  assert.throws(() => readSoleFile(buf), /expected one file in the artifact, found 2/)
})

test('something that is not a zip is refused', () => {
  assert.throws(() => readSoleFile(Buffer.from('<html>Not Found</html>'.padEnd(64))), /not a zip archive/)
})

test('an unsupported compression method is refused rather than misread', () => {
  const buf = zip([{ name: 'b.txt', content: BREAKDOWN }], { method: 0 })
  buf.writeUInt16LE(12, 8) // local header: bzip2
  const dir = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  buf.writeUInt16LE(12, dir + 10)
  assert.throws(() => readSoleFile(buf), /unsupported compression method 12/)
})

test('a truncated entry is refused', () => {
  const buf = zip([{ name: 'b.txt', content: BREAKDOWN }], { method: 0 })
  const dir = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  buf.writeUInt32LE(BREAKDOWN.length + 5, dir + 24)
  assert.throws(() => readSoleFile(buf), /truncated/)
})
