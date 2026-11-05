import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { readPdfText, type PdfTextBlock } from './pdf-text-reader';
import { CJK_FONT_SHA256, breakLines, cjkFontPath, signedDocumentPdf } from './signed-document-pdf';
import type { SignedDocument } from './signed-document-render';
import { labelsFrom } from './signed-documents-builder';
import { crc32 } from './zip-writer';

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

/** A real PNG, `w` by `h`: grey, white with a black line, or (`alpha`) grey
 * and transparent, as a drawn signature is. */
function png(w: number, h: number, alpha = false): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 4 : 0; // grey with alpha, or grey
  const px = alpha ? 2 : 1;
  const rows = Buffer.alloc((w * px + 1) * h, alpha ? 0 : 255);
  for (let y = 0; y < h; y++) rows[y * (w * px + 1)] = 0;
  for (let x = 0; x < w; x++) rows.fill(alpha ? 255 : 0, Math.floor(h / 2) * (w * px + 1) + 1 + x * px + (alpha ? 1 : 0), Math.floor(h / 2) * (w * px + 1) + 1 + (x + 1) * px);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const ARABIC = /\p{Script=Arabic}/u;
/** A block's text in reading order: Arabic is drawn right to left, so its
 * glyphs come out of the PDF reversed. */
const reading = (b: PdfTextBlock) => (ARABIC.test(b.text) ? [...b.glyphs].reverse().join('') : b.text);
/** All the page's words, each block as one. */
const words = (blocks: PdfTextBlock[]) => blocks.map(reading);
/** The lines, top to bottom, each block in drawing order (left to right). */
function lines(blocks: PdfTextBlock[]): PdfTextBlock[][] {
  const byLine = new Map<string, PdfTextBlock[]>();
  for (const b of blocks) {
    const key = `${b.page}:${Math.round(b.y)}`;
    byLine.set(key, [...(byLine.get(key) ?? []), b]);
  }
  return [...byLine.values()].map((l) => l.sort((a, b) => a.x - b.x));
}
/** A line's text, a space between its blocks (words, or a change of font)
 * except before closing punctuation and after an opening bracket. */
const lineText = (l: PdfTextBlock[]) => l.map((b, i) => (i > 0 && !/^[.,:;!?)]/.test(b.text) && !/\($/.test(l[i - 1].text) ? ' ' : '') + b.text).join('');

describe('signed document PDF (Decision 422 item 10)', () => {
  const labels = labelsFrom({});

  it('is a real PDF holding what the page showed, as text', async () => {
    const pdf = await signedDocumentPdf(
      doc({ byGuardian: true, signerName: 'Paula Lima', memberName: 'Kid Lima', expired: true, image: { bytes: png(300, 80), contentType: 'image/png' } }),
      'Dojo & Co',
      labels,
    );
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF');
    const { pages, blocks } = readPdfText(pdf);
    expect(pages).toBe(1);
    const text = lines(blocks).map(lineText);
    expect(text).toEqual(
      expect.arrayContaining([
        'Dojo & Co',
        'Liability waiver',
        'Expired',
        'Member',
        'Kid Lima',
        'Signed name',
        'Paula Lima (Guardian)',
        'Signature',
        'Ana',
        'Signed at',
        '2026-05-06 07:08 UTC',
        'Version',
        '2',
        'SHA-256',
        'abc123',
        'Text signed',
        'I agree to train safely.',
        '1 / 1',
      ]),
    );
    expect(text.indexOf('Dojo & Co')).toBeLessThan(text.indexOf('Liability waiver'));
    expect(text.indexOf('abc123')).toBeLessThan(text.indexOf('Text signed'));
    // The drawn signature is in it, as an image.
    expect(pdf.toString('latin1')).toMatch(/\/Subtype \/Image/);
    expect(pdf.toString('latin1')).toMatch(/\/Title \d+ 0 R/);
  });

  it('a paper signature shows who recorded it; a missing or unreadable image and unkept wording say so', async () => {
    const paper = lines(readPdfText(await signedDocumentPdf(doc({ onPaper: true, recordedByName: 'Olivia Owner', body: null }), 'S', labels)).blocks).map(lineText);
    expect(paper).toEqual(expect.arrayContaining(['Ana Lima (On paper)', 'Recorded by', 'Olivia Owner', "The wording signed wasn't kept for this signature."]));
    expect(paper).not.toContain('Signature');

    const missing = lines(readPdfText(await signedDocumentPdf(doc({ imageMissing: true }), 'S', labels)).blocks).map(lineText);
    expect(missing).toContain("The signature image couldn't be found.");
    // PNG's first bytes, but not a picture pdfkit can read: the export goes on.
    // A transparent drawn signature, which pdfkit reads only as it writes.
    const drawn = await signedDocumentPdf(doc({ image: { bytes: png(200, 60, true), contentType: 'image/png' } }), 'S', labels);
    expect(drawn.toString('latin1')).toMatch(/\/SMask \d+ 0 R/);
    expect(lines(readPdfText(drawn).blocks).map(lineText)).not.toContain("The signature image couldn't be found.");
    const broken = await signedDocumentPdf(doc({ image: { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), contentType: 'image/png' } }), 'S', labels);
    expect(lines(readPdfText(broken).blocks).map(lineText)).toContain("The signature image couldn't be found.");
    const good = png(200, 60, true);
    const idat = good.indexOf('IDAT', 0, 'latin1');
    const damaged = Buffer.from(good);
    damaged.fill(0x55, idat + 6, idat + 30);
    const fromDamaged = await signedDocumentPdf(doc({ image: { bytes: damaged, contentType: 'image/png' } }), 'S', labels);
    expect(lines(readPdfText(fromDamaged).blocks).map(lineText)).toContain("The signature image couldn't be found.");
  });

  it('runs a long document over as many pages as it needs, keeping every word and line break', async () => {
    const paragraph = (n: number) => `Clause ${n}. ${'The member agrees to follow the instructor and the rules of the School at all times. '.repeat(6).trim()}`;
    const body = Array.from({ length: 40 }, (_, i) => paragraph(i + 1)).join('\n\n');
    const { pages, blocks } = readPdfText(await signedDocumentPdf(doc({ body }), 'S', labels));
    expect(pages).toBeGreaterThan(3);
    const all = lines(blocks).map(lineText);
    for (let p = 1; p <= pages; p++) expect(all).toContain(`${p} / ${pages}`);
    const text = all.filter((l) => !/^\d+ \/ \d+$/.test(l)).join(' ');
    for (let n = 1; n <= 40; n++) expect(text).toContain(`Clause ${n}. The member agrees`);
    expect(text.split('rules of the School at all times.').length - 1).toBe(240);
  });

  it('writes Arabic right to left, joined, with numbers and Latin words the right way round', async () => {
    const ar = labelsFrom({ member: 'العضو', signedAt: 'تاريخ التوقيع', textSigned: 'النص الموق\u0651ع', guardian: 'ولي\u0651 الأمر' });
    const pdf = await signedDocumentPdf(
      doc({ memberName: 'أحمد علي', signerName: 'ليلى علي', byGuardian: true, title: 'إقرار المسؤولية', body: 'أوافق على القاعدة 123 في Dojo Lima (التوقيع)' }),
      'مدرسة الكاراتيه',
      ar,
    );
    const { blocks } = readPdfText(pdf);
    // The letters copy as they read, even where Arabic shares one shape
    // between letters (ت and ي in التوقيع).
    expect(words(blocks)).toEqual(expect.arrayContaining(['مدرسة', 'الكاراتيه', 'إقرار', 'المسؤولية', 'العضو', 'أحمد', 'علي', 'تاريخ', 'التوقيع', 'ولي\u0651', 'الأمر']));
    const body = lines(blocks).find((l) => l.some((b) => b.text === 'Dojo'))!;
    // Right to left: the first word is furthest right, and the line ends at
    // the right margin.
    const order = body.map(reading).reverse();
    expect(order).toEqual(['أوافق', 'على', 'القاعدة', '123', 'في', 'Lima', 'Dojo', ')', 'التوقيع', '(']);
    // "Dojo Lima" stays left to right inside it.
    expect(body.findIndex((b) => b.text === 'Dojo')).toBeLessThan(body.findIndex((b) => b.text === 'Lima'));
    // The bracket is drawn mirrored, so it opens toward the word it holds.
    expect(body[0].text).toBe('(');
  });

  it('lines one-line values up with the document, not with their own letters (Decision 433, TXT-5)', async () => {
    const ar = labelsFrom({ member: 'العضو', signedAt: 'تاريخ التوقيع', textSigned: 'النص الموق\u0651ع', version: 'الإصدار' });
    const pdf = await signedDocumentPdf(doc({ memberName: 'Ana Lima', sha256: 'abc123', body: 'I agree.' }), 'Dojo', ar);
    const { blocks } = readPdfText(pdf);
    const sha = blocks.find((b) => b.text === 'abc123')!;
    const agree = blocks.find((b) => b.text.startsWith('I'))!;
    // In an Arabic document the Latin SHA-256 sits on the right, under its
    // label; the wording signed keeps its own (left to right) direction.
    expect(sha.x).toBeGreaterThan(300);
    expect(agree.x).toBeLessThan(100);

    // An English document keeps an Arabic name on the left.
    const en = readPdfText(await signedDocumentPdf(doc({ memberName: 'أحمد' }), 'Dojo', labels)).blocks;
    expect(en.find((b) => ARABIC.test(b.text))!.x).toBeLessThan(100);
  });

  it('writes the Dirham sign, which no font has, as د.إ (Decision 433, TXT-5)', async () => {
    const pdf = await signedDocumentPdf(doc({ body: 'Fee 500 \u20C3 a month.' }), 'Dojo', labels);
    const text = words(readPdfText(pdf).blocks).join(' ');
    expect(text).not.toContain('\u20C3');
    expect(text).toMatch(/د ?\. ?إ|إ ?\. ?د/);
  });

  it('writes Japanese, Chinese, Korean, Thai and Cyrillic in fonts that have them, breaking lines between words', async () => {
    const sentence = '私はこのスクールの規則に同意し、安全に練習します。';
    const body = `${sentence.repeat(12)}\n中文：我同意学校的规定。\n한국어: 학교 규칙에 동의합니다.\nฉ\u0E31นยอมร\u0E31บกฎของโรงเร\u0E35ยน\nЯ согласен с правилами.`;
    const pdf = await signedDocumentPdf(doc({ memberName: '山田太郎', title: '免責同意書', body }), '東京道場', labels);
    const { blocks } = readPdfText(pdf);
    const all = lines(blocks).map(lineText);
    expect(all).toEqual(expect.arrayContaining(['東京道場', '免責同意書', '山田太郎', '中文：我同意学校的规定。', '한국어: 학교 규칙에 동의합니다.', 'ฉ\u0E31นยอมร\u0E31บกฎของโรงเร\u0E35ยน', 'Я согласен с правилами.']));
    // The long Japanese paragraph wraps onto several lines, all of it there.
    const japanese = all.filter((l) => l.includes('スクール') || l.includes('練習') || l.includes('規則'));
    expect(japanese.length).toBeGreaterThan(2);
    expect(japanese.join('').replace(/ /g, '')).toBe(sentence.repeat(12));
    // No character fell back to a missing glyph.
    expect(blocks.every((b) => !b.text.includes('�'))).toBe(true);
    const fonts = pdf.toString('latin1').match(/\/BaseFont \/[A-Z]{6}\+[\w-]+/g) ?? [];
    expect(fonts.map((f) => f.replace(/.*\+/, ''))).toEqual(expect.arrayContaining(['NotoSansCJKjp-Regular', 'NotoSansThai-Regular', 'NotoSans-Regular']));
  });

  it('breaks lines at spaces, and between words of scripts that have none', () => {
    expect(breakLines('one two three four', 20).length).toBe(1);
    const narrow = breakLines('one two three four', 4);
    expect(narrow.map(([s, e]) => 'one two three four'.slice(s, e))).toEqual(['one two', 'three', 'four']);
    const thai = 'ฉ\u0E31นยอมร\u0E31บกฎของโรงเร\u0E35ยน';
    const thaiLines = breakLines(thai, 3).map(([s, e]) => thai.slice(s, e));
    expect(thaiLines.length).toBeGreaterThan(1);
    expect(thaiLines.join('')).toBe(thai);
    // Punctuation stays on its word; a word too long for a line is split.
    expect(breakLines('end. (start', 3).map(([s, e]) => 'end. (start'.slice(s, e))).toEqual(['end.', '(start']);
    expect(breakLines('x'.repeat(100), 10).length).toBeGreaterThan(1);
  });

  it('uses the upstream Noto Sans CJK font file', () => {
    expect(createHash('sha256').update(readFileSync(cjkFontPath())).digest('hex')).toBe(CJK_FONT_SHA256);
  });
});
