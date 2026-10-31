import { SIGNED_DOCUMENT_LABEL_DEFAULTS } from './dto/signed-documents.dto';
import { labelsFrom } from './signed-documents-builder';
import { csvCell, documentFileName, imageTypeOf, indexCsv, signedDocumentHtml, type SignedDocument } from './signed-document-render';

const doc = (over: Partial<SignedDocument> = {}): SignedDocument => ({
  id: 'sig-1',
  kind: 'MEMBER',
  memberName: 'Ana Lima',
  title: 'Liability waiver',
  version: 2,
  body: 'I agree <script>alert(1)</script>',
  sha256: 'abc',
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

describe('signed-document rendering', () => {
  const labels = labelsFrom({});

  it('uses the portal’s words, English for any left out or blank', () => {
    expect(labelsFrom({ member: ' Aluno ', document: '', unknown: 'x' })).toEqual({ ...SIGNED_DOCUMENT_LABEL_DEFAULTS, member: 'Aluno' });
    expect(labelsFrom(null)).toEqual(SIGNED_DOCUMENT_LABEL_DEFAULTS);
  });

  it('never lets a spreadsheet read a cell as a formula, and quotes when needed', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell('plain')).toBe('plain');
  });

  it('marks a Guardian’s and a paper signature, and a guest, in the index', () => {
    const csv = indexCsv(
      [
        { doc: doc({ byGuardian: true, signerName: 'Paula Lima' }), file: 'a.html' },
        { doc: doc({ onPaper: true }), file: 'b.html' },
        { doc: doc({ kind: 'GUEST', memberName: 'Gus', version: null, expired: true }), file: 'c.html' },
      ],
      labels,
    ).toString('utf8');
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Member,Document,Version,Signed at,Signed by,File',
      'Ana Lima,Liability waiver,2,2026-05-06 07:08 UTC,Paula Lima (Guardian),a.html',
      'Ana Lima,Liability waiver,2,2026-05-06 07:08 UTC,Ana Lima (On paper),b.html',
      'Gus (Guest),Liability waiver (Expired),,2026-05-06 07:08 UTC,Ana Lima,c.html',
      '',
    ]);
  });

  it('escapes everything a School or member typed in the document', () => {
    const html = signedDocumentHtml(doc({ memberName: '<b>Ana</b>' }), 'Dojo & Co', labels).toString('utf8');
    expect(html).not.toContain('<script>');
    expect(html).toContain('I agree &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(html).toContain('Dojo &amp; Co');
    expect(signedDocumentHtml(doc({ body: null }), 'S', labels).toString('utf8')).toContain('The wording signed wasn&#39;t kept for this signature.');
  });

  it('names files safely and reads the image type from its bytes', () => {
    expect(documentFileName(7, doc({ memberName: 'A/B:C*', title: 'W?<>|"' }))).toBe('documents/00007 A_B_C_ - W_____.html');
    expect(imageTypeOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(imageTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageTypeOf(Buffer.from('GIF89a'))).toBeNull();
  });
});
