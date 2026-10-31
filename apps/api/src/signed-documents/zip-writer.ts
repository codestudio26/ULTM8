import { deflateRawSync } from 'zlib';

/** Most entries and bytes a plain (non-ZIP64) archive can hold. */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, as a ZIP entry stores them (2-second steps, UTC). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/**
 * A small ZIP writer for the signed-documents export (Decision 315 item 13):
 * each file is added whole, deflated when that makes it smaller, with a UTF-8
 * name. No dependency: Node's zlib does the compression. Plain ZIP only (up
 * to 65,535 files and 4 GB), which `add` and `finish` check.
 */
export class ZipWriter {
  private readonly parts: Buffer[] = [];
  private readonly central: Buffer[] = [];
  private offset = 0;
  private count = 0;

  get size(): number {
    return this.offset;
  }

  add(name: string, data: Buffer, modified = new Date()): void {
    if (this.count + 1 > ZIP_MAX_ENTRIES) throw new Error('Too many files for one ZIP.');
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = deflateRawSync(data);
    const stored = deflated.length < data.length ? deflated : data;
    const method = stored === deflated ? 8 : 0;
    const { time, date } = dosDateTime(modified);
    if (this.offset + 30 + nameBytes.length + stored.length > ZIP_MAX_BYTES) throw new Error('The ZIP would be larger than 4 GB.');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(stored.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    // extra, comment, disk, internal and external attributes stay 0
    entry.writeUInt32LE(this.offset, 42);

    this.parts.push(local, nameBytes, stored);
    this.central.push(entry, nameBytes);
    this.offset += local.length + nameBytes.length + stored.length;
    this.count += 1;
  }

  finish(): Buffer {
    const centralDir = Buffer.concat(this.central);
    if (this.offset + centralDir.length + 22 > ZIP_MAX_BYTES) throw new Error('The ZIP would be larger than 4 GB.');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(centralDir.length, 12);
    end.writeUInt32LE(this.offset, 16);
    return Buffer.concat([...this.parts, centralDir, end]);
  }
}
