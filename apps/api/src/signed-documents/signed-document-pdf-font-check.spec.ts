import { Logger } from '@nestjs/common';
import type { SignedDocument } from './signed-document-render';

// The installed CJK font file is swapped for one whose bytes aren't the
// upstream file's, as a changed package would be; every other file is read
// as it is.
const mockRealFs = jest.requireActual<typeof import('fs')>('fs');
const mockReads = { cjk: 0 };
jest.mock('fs', () => ({
  ...mockRealFs,
  readFileSync: (path: string, ...rest: unknown[]) => {
    if (String(path).endsWith('NotoSansCJKjp-Regular.otf')) {
      mockReads.cjk += 1;
      return Buffer.concat([mockRealFs.readFileSync(path), Buffer.from('tampered')]);
    }
    return (mockRealFs.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
  },
}));

// Imported after the mock, so the module reads fonts through it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CjkFontRejectedError, signedDocumentPdf } = require('./signed-document-pdf') as typeof import('./signed-document-pdf');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { labelsFrom } = require('./signed-documents-builder') as typeof import('./signed-documents-builder');

const doc = (over: Partial<SignedDocument> = {}): SignedDocument => ({
  id: 'sig-1',
  kind: 'MEMBER',
  memberName: 'Ana Lima',
  title: 'Liability waiver',
  version: 2,
  body: 'I agree to train safely.',
  sha256: 'abc123',
  signedAt: new Date('2026-05-06T07:08:09Z'),
  signerName: 'Ana Lima',
  signatureText: 'Ana',
  byGuardian: false,
  onPaper: false,
  recordedByName: null,
  expired: false,
  image: null,
  imageMissing: false,
  ...over,
});

describe('signed document PDF: the CJK font is checked before it is used', () => {
  const labels = labelsFrom({});

  it('refuses a CJK font that is not the upstream file: a PDF that needs it fails with a clear error, logged once; others are made', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(signedDocumentPdf(doc({ memberName: '山田太郎', body: '私は同意します。' }), 'S', labels)).rejects.toBeInstanceOf(CjkFontRejectedError);
    await expect(signedDocumentPdf(doc({ title: '免責同意書' }), 'S', labels)).rejects.toThrow(/has SHA-256 [0-9a-f]{64}, not the expected 68a3fc98.*it was not used/);
    // The file was read and hashed once, and the refusal logged once.
    expect(mockReads.cjk).toBe(1);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain('NotoSansCJKjp-Regular.otf');

    // A document with no Japanese, Chinese or Korean text never needs the font.
    const pdf = await signedDocumentPdf(doc({ body: 'Я согласен. أوافق. ฉันยอมรับ' }), 'S', labels);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).not.toContain('NotoSansCJK');
    logged.mockRestore();
  });
});
