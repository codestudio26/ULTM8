import { inflateRawSync } from 'zlib';
import { crc32 } from './zip-writer';

/**
 * Reads back a ZIP made by ZipWriter (stored or deflated entries, no ZIP64),
 * checking each file's CRC. For the specs: the export's contents are
 * checked by opening the ZIP the job made.
 */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('Not a ZIP: no end of central directory.');
  const count = zip.readUInt16LE(endAt + 10);
  let at = zip.readUInt32LE(endAt + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('Bad central directory entry.');
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    const raw = zip.subarray(dataAt, dataAt + size);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}.`);
    files.set(name, data);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
