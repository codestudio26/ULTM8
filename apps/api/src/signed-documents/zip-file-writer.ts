import { closeSync, openSync, writeSync } from 'fs';
import { deflateRawSync } from 'zlib';
import { crc32, dosDateTime, ZIP_MAX_ENTRIES } from './zip-writer';

/**
 * The largest ZIP the export makes: 2 GB less one byte. The export's
 * `sizeBytes` column is a 32-bit integer, so a larger ZIP could not be
 * recorded (and plain ZIP stops at 4 GB in any case).
 */
export const ZIP_FILE_MAX_BYTES = 0x7fffffff;

export class ZipTooLargeError extends Error {
  constructor() {
    super('The ZIP would be larger than 2 GB.');
    this.name = 'ZipTooLargeError';
  }
}

/**
 * A ZIP written straight to a file on disk, for the signed-documents export
 * once it can include member files (Decision 422 item 9): the ZIP is never
 * held in memory as a whole. Small entries (the documents, the index) are
 * added whole and deflated when that makes them smaller, as ZipWriter does;
 * a member file is streamed in chunk by chunk and stored as it is (PDF, JPG
 * and PNG are compressed already), its CRC and size written back into its
 * header once it has all been read. Plain ZIP only (up to 65,535 files),
 * UTF-8 names, no data descriptors, so ZipWriter's reader and any unzip read
 * it. Not for concurrent use: each call finishes before the next starts.
 */
export class ZipFileWriter {
  private fd: number | null;
  private readonly central: Buffer[] = [];
  private offset = 0;
  private count = 0;

  constructor(
    path: string,
    private readonly maxBytes = ZIP_FILE_MAX_BYTES,
  ) {
    this.fd = openSync(path, 'w');
  }

  /** Bytes written so far. */
  get size(): number {
    return this.offset;
  }

  /** Adds a file that is already in memory. */
  add(name: string, data: Buffer, modified = new Date()): void {
    const deflated = deflateRawSync(data);
    const stored = deflated.length < data.length ? deflated : data;
    const nameBytes = this.startEntry(name, stored.length);
    const headerAt = this.offset;
    const header = this.localHeader(nameBytes, stored === deflated ? 8 : 0, modified, crc32(data), stored.length, data.length);
    this.write(header);
    this.write(nameBytes);
    this.write(stored);
    this.endEntry(nameBytes, headerAt, header);
  }

  /**
   * Streams a file in, stored, reading `source` one chunk at a time.
   * `expectedBytes` (the size on record) lets a file that can't fit fail
   * before any of it is read. Returns the bytes written.
   */
  async addStream(name: string, source: AsyncIterable<Uint8Array>, modified = new Date(), expectedBytes = 0): Promise<number> {
    const nameBytes = this.startEntry(name, expectedBytes);
    const headerAt = this.offset;
    const header = this.localHeader(nameBytes, 0, modified, 0, 0, 0);
    this.write(header);
    this.write(nameBytes);
    let crc = 0;
    let size = 0;
    for await (const chunk of source) {
      if (this.offset + chunk.length + 46 + nameBytes.length + 22 > this.maxBytes) throw new ZipTooLargeError();
      crc = crc32(chunk, crc);
      size += chunk.length;
      this.write(chunk);
    }
    // The CRC and sizes, now known, into the header written before the data.
    const tail = Buffer.alloc(12);
    tail.writeUInt32LE(crc, 0);
    tail.writeUInt32LE(size, 4);
    tail.writeUInt32LE(size, 8);
    writeSync(this.openFd(), tail, 0, tail.length, headerAt + 14);
    header.set(tail, 14);
    this.endEntry(nameBytes, headerAt, header);
    return size;
  }

  /** Writes the central directory and closes the file. Returns the ZIP's size. */
  finish(): number {
    const centralDir = Buffer.concat(this.central);
    if (this.offset + centralDir.length + 22 > this.maxBytes) throw new ZipTooLargeError();
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(centralDir.length, 12);
    end.writeUInt32LE(this.offset, 16);
    const at = this.offset;
    this.write(centralDir);
    this.write(end);
    this.close();
    return at + centralDir.length + end.length;
  }

  /** Closes the file (safe to call more than once). */
  close(): void {
    if (this.fd === null) return;
    closeSync(this.fd);
    this.fd = null;
  }

  private startEntry(name: string, dataBytes: number): Buffer {
    if (this.count + 1 > ZIP_MAX_ENTRIES) throw new Error('Too many files for one ZIP.');
    const nameBytes = Buffer.from(name, 'utf8');
    // Room for this entry, its central directory record and the end record.
    if (this.offset + 30 + nameBytes.length + dataBytes + 46 + nameBytes.length + 22 > this.maxBytes) throw new ZipTooLargeError();
    return nameBytes;
  }

  /** The central directory record for the entry whose local header is at `headerAt`. */
  private endEntry(nameBytes: Buffer, headerAt: number, local: Buffer): void {
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    // version needed, flags, method, time, date, CRC and both sizes are as in the local header
    local.copy(entry, 6, 4, 26);
    entry.writeUInt16LE(nameBytes.length, 28);
    // extra, comment, disk, internal and external attributes stay 0
    entry.writeUInt32LE(headerAt, 42);
    this.central.push(entry, nameBytes);
    this.count += 1;
  }

  private localHeader(nameBytes: Buffer, method: number, modified: Date, crc: number, storedBytes: number, bytes: number): Buffer {
    const { time, date } = dosDateTime(modified);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(storedBytes, 18);
    local.writeUInt32LE(bytes, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    return local;
  }

  private write(data: Uint8Array): void {
    if (this.offset + data.length > this.maxBytes) throw new ZipTooLargeError();
    let done = 0;
    while (done < data.length) done += writeSync(this.openFd(), data, done, data.length - done, this.offset + done);
    this.offset += data.length;
  }

  private openFd(): number {
    if (this.fd === null) throw new Error('The ZIP is already finished.');
    return this.fd;
  }
}
