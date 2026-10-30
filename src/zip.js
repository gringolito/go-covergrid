'use strict'

// Reads the one file out of an artifact archive. The REST API serves every artifact as a
// zip, and there are no runtime dependencies (ADR-0003) and no promise that a self-hosted
// runner has `unzip`, so this reads the central directory itself.
//
// Only what artifact archives contain is supported: stored or deflated entries, no
// encryption, no Zip64. Sizes come from the central directory, because a streamed archive
// leaves them zero in the local header and puts them in a trailing data descriptor.

const zlib = require('node:zlib')

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50
const STORED = 0
const DEFLATED = 8
const ZIP64_SENTINEL = 0xffffffff

function findEndOfCentralDirectory(buf) {
  // The record is 22 bytes followed by a comment of at most 65535 bytes.
  const lowest = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) return i
  }
  throw new Error('not a zip archive')
}

/**
 * @param {Buffer} buf
 * @returns {{ name: string, method: number, compressedSize: number, size: number, localOffset: number }[]}
 */
function entries(buf) {
  const end = findEndOfCentralDirectory(buf)
  const count = buf.readUInt16LE(end + 10)
  let offset = buf.readUInt32LE(end + 16)

  const found = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) throw new Error('corrupt zip central directory')

    const flags = buf.readUInt16LE(offset + 8)
    const nameLength = buf.readUInt16LE(offset + 28)
    const entry = {
      name: buf.toString('utf8', offset + 46, offset + 46 + nameLength),
      method: buf.readUInt16LE(offset + 10),
      compressedSize: buf.readUInt32LE(offset + 20),
      size: buf.readUInt32LE(offset + 24),
      localOffset: buf.readUInt32LE(offset + 42),
    }
    if (flags & 0x1) throw new Error(`zip entry "${entry.name}" is encrypted`)
    if ([entry.compressedSize, entry.size, entry.localOffset].includes(ZIP64_SENTINEL)) {
      throw new Error(`zip entry "${entry.name}" needs Zip64`)
    }

    found.push(entry)
    offset += 46 + nameLength + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32)
  }
  return found
}

function extract(buf, entry) {
  const at = entry.localOffset
  if (buf.readUInt32LE(at) !== LOCAL_FILE_HEADER) throw new Error(`corrupt zip entry "${entry.name}"`)

  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28)
  const raw = buf.subarray(start, start + entry.compressedSize)

  let data
  if (entry.method === STORED) data = raw
  else if (entry.method === DEFLATED) data = zlib.inflateRawSync(raw)
  else throw new Error(`zip entry "${entry.name}" uses unsupported compression method ${entry.method}`)

  if (data.length !== entry.size) throw new Error(`zip entry "${entry.name}" is truncated`)
  return data
}

/**
 * The contents of the archive's only file. A breakdown artifact holds exactly one, so
 * anything else means the artifact is not what this action uploaded.
 *
 * @param {Buffer} buf
 * @returns {{ name: string, data: Buffer }}
 */
function readSoleFile(buf) {
  const files = entries(buf).filter((e) => !e.name.endsWith('/'))
  if (files.length !== 1) {
    throw new Error(`expected one file in the artifact, found ${files.length}`)
  }
  return { name: files[0].name, data: extract(buf, files[0]) }
}

module.exports = { readSoleFile }
