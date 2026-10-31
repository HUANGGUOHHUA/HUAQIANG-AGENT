function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function writeU16(view: DataView, offset: number, value: number): number {
  view.setUint16(offset, value, true)
  return offset + 2
}

function writeU32(view: DataView, offset: number, value: number): number {
  view.setUint32(offset, value, true)
  return offset + 4
}

/** Build a small standards-compliant ZIP archive containing one UTF-8 file. */
export function createZipBytes(filename: string, content: string): Uint8Array {
  const name = utf8(filename)
  const data = utf8(content)
  const crc = crc32(data)
  const now = new Date()
  const dosTime =
    (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const dosDate =
    ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

  const local = new Uint8Array(30 + name.length)
  const localView = new DataView(local.buffer)
  let offset = 0
  offset = writeU32(localView, offset, 0x04034b50)
  offset = writeU16(localView, offset, 20)
  offset = writeU16(localView, offset, 0x0800)
  offset = writeU16(localView, offset, 0)
  offset = writeU16(localView, offset, dosTime)
  offset = writeU16(localView, offset, dosDate)
  offset = writeU32(localView, offset, crc)
  offset = writeU32(localView, offset, data.length)
  offset = writeU32(localView, offset, data.length)
  offset = writeU16(localView, offset, name.length)
  offset = writeU16(localView, offset, 0)
  local.set(name, offset)

  const central = new Uint8Array(46 + name.length)
  const centralView = new DataView(central.buffer)
  offset = 0
  offset = writeU32(centralView, offset, 0x02014b50)
  offset = writeU16(centralView, offset, 20)
  offset = writeU16(centralView, offset, 20)
  offset = writeU16(centralView, offset, 0x0800)
  offset = writeU16(centralView, offset, 0)
  offset = writeU16(centralView, offset, dosTime)
  offset = writeU16(centralView, offset, dosDate)
  offset = writeU32(centralView, offset, crc)
  offset = writeU32(centralView, offset, data.length)
  offset = writeU32(centralView, offset, data.length)
  offset = writeU16(centralView, offset, name.length)
  offset = writeU16(centralView, offset, 0)
  offset = writeU16(centralView, offset, 0)
  offset = writeU16(centralView, offset, 0)
  offset = writeU16(centralView, offset, 0)
  offset = writeU32(centralView, offset, 0)
  offset = writeU32(centralView, offset, 0)
  central.set(name, offset)

  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  offset = 0
  offset = writeU32(endView, offset, 0x06054b50)
  offset = writeU16(endView, offset, 0)
  offset = writeU16(endView, offset, 0)
  offset = writeU16(endView, offset, 1)
  offset = writeU16(endView, offset, 1)
  offset = writeU32(endView, offset, central.length)
  offset = writeU32(endView, offset, local.length + data.length)
  offset = writeU16(endView, offset, 0)

  const archive = new Uint8Array(local.length + data.length + central.length + end.length)
  archive.set(local, 0)
  archive.set(data, local.length)
  archive.set(central, local.length + data.length)
  archive.set(end, local.length + data.length + central.length)
  return archive
}
