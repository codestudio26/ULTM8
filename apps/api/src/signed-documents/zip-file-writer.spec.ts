import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { crc32 } from './zip-writer';
import { ZipFileWriter, ZipTooLargeError } from './zip-file-writer';
import { readZip } from './zip-reader';

async function* chunks(...parts: Buffer[]): AsyncIterable<Uint8Array> {
  for (const p of parts) yield p;
}

describe('ZipFileWriter (Decision 422 item 9)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zip-file-writer-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('continues a CRC over several chunks', () => {
    const whole = Buffer.from('123456789');
    expect(crc32(whole.subarray(4), crc32(whole.subarray(0, 4)))).toBe(crc32(whole));
    expect(crc32(whole)).toBe(0xcbf43926);
  });

  it('writes whole and streamed files to disk that read back unchanged', async () => {
    const path = join(dir, 'out.zip');
    const zip = new ZipFileWriter(path);
    const text = Buffer.from('Waiver — assinatura\n'.repeat(500));
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 70_000 }, (_, i) => (i * 31) % 256))]);
    zip.add('documents/00001 Ana.html', text);
    const written = await zip.addStream('member-files/Ana Lima-12345678/scan.pdf', chunks(pdf.subarray(0, 1000), pdf.subarray(1000, 65_536), pdf.subarray(65_536)), new Date('2026-05-01T10:00:00Z'), pdf.length);
    expect(written).toBe(pdf.length);
    await zip.addStream('member-files/empty.png', chunks());
    zip.add('index.csv', Buffer.from('a,b\r\n'));
    const size = zip.finish();

    const out = readFileSync(path);
    expect(out.length).toBe(size);
    const files = readZip(out);
    expect([...files.keys()]).toEqual(['documents/00001 Ana.html', 'member-files/Ana Lima-12345678/scan.pdf', 'member-files/empty.png', 'index.csv']);
    expect(files.get('documents/00001 Ana.html')!.equals(text)).toBe(true);
    expect(files.get('member-files/Ana Lima-12345678/scan.pdf')!.equals(pdf)).toBe(true);
    expect(files.get('member-files/empty.png')!.length).toBe(0);
  });

  it('refuses a ZIP larger than its limit, before reading a file that cannot fit and while streaming one', async () => {
    const zip = new ZipFileWriter(join(dir, 'small.zip'), 2000);
    zip.add('a.txt', Buffer.alloc(100, 1));
    // The size on record is too large: nothing of it is read.
    let read = false;
    async function* never(): AsyncIterable<Uint8Array> {
      read = true;
      yield Buffer.alloc(1);
    }
    await expect(zip.addStream('big.pdf', never(), new Date(), 5000)).rejects.toBeInstanceOf(ZipTooLargeError);
    expect(read).toBe(false);
    // The size on record was wrong: it stops once the limit is passed.
    await expect(zip.addStream('liar.pdf', chunks(Buffer.alloc(1000), Buffer.alloc(1000)), new Date(), 10)).rejects.toBeInstanceOf(ZipTooLargeError);
    zip.close();
    zip.close();
  });

  it('is a ZIP the system unzip accepts, when it is installed', async () => {
    try {
      execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    } catch {
      return;
    }
    const path = join(dir, 'test.zip');
    const zip = new ZipFileWriter(path);
    zip.add('index.csv', Buffer.from('hello '.repeat(50)));
    await zip.addStream('member-files/Jo-1/ç.pdf', chunks(Buffer.from('%PDF-'), Buffer.alloc(5000, 7)));
    zip.finish();
    expect(() => execFileSync('unzip', ['-t', path], { stdio: 'pipe' })).not.toThrow();
  });
});
