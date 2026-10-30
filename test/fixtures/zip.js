'use strict'

// Test tooling: builds zip archives byte by byte, so the reader can be fed shapes no
// archiver on this machine would produce on demand.

const zlib = require('node:zlib')

/**
 * Builds an archive the way a streaming writer does when `streamed` is set: zero sizes in
 * the local header, the real ones in a data descriptor and the central directory.
 * `localExtra`, `centralExtra` and `fileComment` pad every entry with that many bytes, as
 * real archivers do with timestamp and Unix-permission extra fields.
 */
function zip(
  files,
  { method = 8, streamed = false, comment = '', localExtra = 0, centralExtra = 0, fileComment = 0 } = {},
) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const { name, content } of files) {
    const nameBuf = Buffer.from(name)
    const data = Buffer.from(content)
    const packed = method === 8 ? zlib.deflateRawSync(data) : data
    const flags = streamed ? 0x8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(streamed ? 0 : packed.length, 18)
    local.writeUInt32LE(streamed ? 0 : data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(localExtra, 28)

    const parts = [local, nameBuf, Buffer.alloc(localExtra, 0x55), packed]
    if (streamed) {
      const descriptor = Buffer.alloc(16)
      descriptor.writeUInt32LE(0x08074b50, 0)
      descriptor.writeUInt32LE(packed.length, 8)
      descriptor.writeUInt32LE(data.length, 12)
      parts.push(descriptor)
    }
    const record = Buffer.concat(parts)
    locals.push(record)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(centralExtra, 30)
    central.writeUInt16LE(fileComment, 32)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, nameBuf, Buffer.alloc(centralExtra, 0x55), Buffer.alloc(fileComment, 0x43)]))

    offset += record.length
  }

  const directory = Buffer.concat(centrals)
  const commentBuf = Buffer.from(comment)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(commentBuf.length, 20)

  return Buffer.concat([...locals, directory, end, commentBuf])
}

module.exports = { zip }
