import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { crc32, ZipWriter } from './zip-writer';
import { readZip } from './zip-reader';

describe('ZipWriter', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it('writes files that read back unchanged, deflated or stored, with UTF-8 names', () => {
    const zip = new ZipWriter();
    const text = Buffer.from('Waiver — assinatura do responsável\n'.repeat(200));
    const random = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 97 + 13) % 256));
    zip.add('index.csv', text);
    zip.add('documents/0001-João-Liability.html', random);
    zip.add('empty.txt', Buffer.alloc(0));
    const out = zip.finish();

    const files = readZip(out);
    expect([...files.keys()]).toEqual(['index.csv', 'documents/0001-João-Liability.html', 'empty.txt']);
    expect(files.get('index.csv')!.equals(text)).toBe(true);
    expect(files.get('documents/0001-João-Liability.html')!.equals(random)).toBe(true);
    expect(files.get('empty.txt')!.length).toBe(0);
    // Repetitive text is stored deflated, so the ZIP is much smaller than it.
    expect(out.length).toBeLessThan(text.length);
  });

  it('is a ZIP the system unzip accepts, when it is installed', () => {
    let hasUnzip = true;
    try {
      execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    } catch {
      hasUnzip = false;
    }
    if (!hasUnzip) return;
    const dir = mkdtempSync(join(tmpdir(), 'zip-writer-'));
    try {
      const zip = new ZipWriter();
      zip.add('a.txt', Buffer.from('hello '.repeat(50)));
      zip.add('b/ç.txt', Buffer.from('x'));
      writeFileSync(join(dir, 'test.zip'), zip.finish());
      expect(() => execFileSync('unzip', ['-t', join(dir, 'test.zip')], { stdio: 'pipe' })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
