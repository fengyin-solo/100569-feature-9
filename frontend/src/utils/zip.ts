// 纯前端打 zip（STORE，不压缩）：分册包下载不需要第三方库，多个 CSV 直接拼成一个包下发。
export type ZipEntry = {
  filename: string
  content: string
}

class ByteWriter {
  private bytes: number[] = []

  get length(): number {
    return this.bytes.length
  }

  u16(value: number): this {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff)
    return this
  }

  u32(value: number): this {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
    return this
  }

  data(value: Uint8Array): this {
    for (const byte of value) {
      this.bytes.push(byte)
    }
    return this
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let crc = n
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    table[n] = crc >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const encoder = new TextEncoder()

function dosDateTime(): { date: number; time: number } {
  const now = new Date()
  const year = Math.max(1980, now.getFullYear())
  return {
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
  }
}

export function buildZipBlob(entries: ZipEntry[]): Blob {
  const localParts: { header: ByteWriter; filename: Uint8Array; content: Uint8Array; offset: number }[] = []
  const central = new ByteWriter()
  const stream = new ByteWriter()
  const stamp = dosDateTime()

  for (const entry of entries) {
    const filename = encoder.encode(entry.filename)
    const content = encoder.encode(entry.content)
    const checksum = crc32(content)
    const offset = stream.length

    // 本地文件头
    const header = new ByteWriter()
    header
      .u32(0x04034b50)
      .u16(20)
      .u16(0x0800) // bit 11：文件名按 UTF-8 解析
      .u16(0) // STORE
      .u16(stamp.time)
      .u16(stamp.date)
      .u32(checksum)
      .u32(content.length)
      .u32(content.length)
      .u16(filename.length)
      .u16(0)
    stream.data(header.toUint8Array()).data(filename).data(content)

    // 中央目录头
    central
      .u32(0x02014b50)
      .u16(20)
      .u16(20)
      .u16(0x0800)
      .u16(0)
      .u16(stamp.time)
      .u16(stamp.date)
      .u32(checksum)
      .u32(content.length)
      .u32(content.length)
      .u16(filename.length)
      .u16(0)
      .u16(0)
      .u16(0)
      .u16(0)
      .u32(0)
      .u32(offset)
      .data(filename)

    localParts.push({ header, filename, content, offset })
  }

  const centralOffset = stream.length
  const centralBytes = central.toUint8Array()
  stream.data(centralBytes)

  stream.data(
    new ByteWriter()
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(localParts.length)
      .u16(localParts.length)
      .u32(centralBytes.length)
      .u32(centralOffset)
      .u16(0)
      .toUint8Array(),
  )

  return new Blob([stream.toUint8Array().buffer as ArrayBuffer], { type: 'application/zip;charset=utf-8' })
}
