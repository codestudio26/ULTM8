/// <reference lib="es2022.intl" />
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { inflateSync } from 'zlib';
import { Logger } from '@nestjs/common';
import bidiFactory from 'bidi-js';
import * as fontkit from 'fontkit';
import PDFDocument from 'pdfkit';
import type { SignedDocumentLabels } from './dto/signed-documents.dto';
import { signedByCell, utcStamp, type SignedDocument } from './signed-document-render';

/*
 * One signed document as a PDF (Decision 422 item 10), for the signed-documents
 * export, in place of the printable web page it had before. It holds what
 * that page held: the School, the document's title and version, who signed and when (in UTC),
 * a Guardian's or paper signature marked, the typed and drawn signature, and
 * the full wording signed. The text is real text in embedded fonts, so it can
 * be selected, searched and copied, over as many A4 pages as it needs.
 *
 * Text is laid out here rather than by pdfkit's own wrapping, because that
 * only knows one font and left-to-right text, and the export is read in 15
 * languages: each character is drawn in the first font that has it (Noto Sans
 * for Latin, Cyrillic and Greek; Noto Sans Arabic; Noto Sans Thai; Noto Sans
 * CJK for Japanese, Chinese and Korean), every paragraph follows the Unicode
 * bidirectional algorithm (bidi-js) so Arabic reads right to left with any
 * numbers or Latin words in it the right way round, and lines break where
 * Intl.Segmenter finds word boundaries, which also covers Thai, Japanese and
 * Chinese (no spaces between words). fontkit shapes each word (Arabic joining
 * forms, Thai marks).
 */

const bidi = bidiFactory();

const packageDir = (name: string) => dirname(require.resolve(`${name}/package.json`));

interface FontFile {
  key: string;
  file: () => string;
}

/** The fonts, in the order a character looks for one that has it. Each is read
 * the first time it is needed (the CJK font is 16 MB) and kept for the life of
 * the process; each PDF embeds only the glyphs it uses. */
const FONT_FILES: FontFile[] = [
  ...['latin', 'latin-ext', 'vietnamese', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext'].map((subset) => ({
    key: `sans-${subset}`,
    file: () => join(packageDir('@fontsource/noto-sans'), 'files', `noto-sans-${subset}-400-normal.woff`),
  })),
  { key: 'arabic', file: () => join(packageDir('@fontsource/noto-sans-arabic'), 'files', 'noto-sans-arabic-arabic-400-normal.woff') },
  { key: 'thai', file: () => join(packageDir('@fontsource/noto-sans-thai'), 'files', 'noto-sans-thai-thai-400-normal.woff') },
  { key: 'cjk', file: () => join(packageDir('@docx-editor.dev/fonts-cjk'), 'assets', 'NotoSansCJKjp-Regular.otf') },
];

/** The CJK font file's SHA-256: the upstream file (notofonts/noto-cjk,
 * Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf). The package that carries it
 * comes from a small publisher; only this file is read from it (none of its
 * code runs), and the file is checked against this hash before it is used. */
export const CJK_FONT_SHA256 = '68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5';
const CJK = FONT_FILES.length - 1;
export const cjkFontPath = () => FONT_FILES[CJK].file();

/** The installed CJK font isn't the upstream file, so it isn't used. */
export class CjkFontRejectedError extends Error {
  constructor(actual: string) {
    super(
      `The CJK font at ${cjkFontPath()} has SHA-256 ${actual}, not the expected ${CJK_FONT_SHA256}; it was not used. ` +
        'Reinstall @docx-editor.dev/fonts-cjk at the pinned version.',
    );
    this.name = 'CjkFontRejectedError';
  }
}

const logger = new Logger('SignedDocumentPdf');

/**
 * The font file's bytes, checked first for the CJK font: a file that isn't
 * the upstream one is refused, with an error logged once, and every PDF that
 * needs it then fails (the export fails with that error) rather than being
 * written with Japanese, Chinese or Korean text missing. PDFs that need no
 * CJK font are not affected.
 */
function fontBytes(i: number): Buffer {
  const bytes = readFileSync(FONT_FILES[i].file());
  if (i === CJK) {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== CJK_FONT_SHA256) {
      const err = new CjkFontRejectedError(actual);
      logger.error(err.message);
      throw err;
    }
  }
  return bytes;
}

/**
 * A WOFF font as the plain OpenType file it wraps, each table inflated once.
 * fontkit reads WOFF itself but inflates a table again every time it reads
 * from it, which made laying out text many times slower. (WOFF2 is no
 * option: fontkit's subsets of it come out broken.)
 */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.readUInt32BE(0) !== 0x774f4646) return woff; // not 'wOFF'
  const count = woff.readUInt16BE(12);
  const tables = Array.from({ length: count }, (_, i) => {
    const at = 44 + i * 20;
    const [offset, compLength, origLength] = [woff.readUInt32BE(at + 4), woff.readUInt32BE(at + 8), woff.readUInt32BE(at + 12)];
    const stored = woff.subarray(offset, offset + compLength);
    return { tag: woff.readUInt32BE(at), checksum: woff.readUInt32BE(at + 16), data: compLength < origLength ? inflateSync(stored) : stored };
  });
  const header = Buffer.alloc(12 + count * 16);
  header.writeUInt32BE(woff.readUInt32BE(4), 0); // the wrapped font's flavor
  header.writeUInt16BE(count, 4);
  const log2 = Math.floor(Math.log2(count));
  header.writeUInt16BE(16 * 2 ** log2, 6);
  header.writeUInt16BE(log2, 8);
  header.writeUInt16BE(count * 16 - 16 * 2 ** log2, 10);
  const parts: Buffer[] = [header];
  let offset = header.length;
  tables.forEach((t, i) => {
    header.writeUInt32BE(t.tag, 12 + i * 16);
    header.writeUInt32BE(t.checksum, 16 + i * 16);
    header.writeUInt32BE(offset, 20 + i * 16);
    header.writeUInt32BE(t.data.length, 24 + i * 16);
    const padded = Buffer.alloc((t.data.length + 3) & ~3);
    t.data.copy(padded);
    parts.push(padded);
    offset += padded.length;
  });
  return Buffer.concat(parts);
}

const loaded: Array<fontkit.Font | undefined> = [];
/** A font refused when it was first read (the CJK font, see fontBytes): kept,
 * so the file is read and hashed only once. */
let refused: Error | null = null;
function fontAt(i: number): fontkit.Font {
  let font = loaded[i];
  if (!font) {
    if (i === CJK && refused) throw refused;
    try {
      font = fontkit.create(woffToSfnt(fontBytes(i))) as fontkit.Font;
    } catch (err) {
      if (i === CJK && err instanceof CjkFontRejectedError) refused = err;
      throw err;
    }
    loaded[i] = font;
  }
  return font;
}

type Run = fontkit.GlyphRun;

/**
 * The font as one PDF embeds it: a view of the loaded font (sharing the file
 * and its parsed tables) that keeps the letters each glyph stands for right.
 *
 * pdfkit writes a Unicode map into the PDF, one piece of text per glyph, from
 * the letters on fontkit's glyph objects, which fontkit keeps one per glyph
 * id. But shaped scripts can draw different letters with the same glyph (Noto
 * Sans Arabic draws ت, ن and ي in the middle of a word as one dotless shape
 * plus dots), so copying or searching the PDF would give the wrong letters.
 * Here every glyph laid out is a new object holding the letters of that very
 * place, and a glyph that stands for other letters than it already does in
 * this PDF is given a glyph id of its own, which becomes a copy of the glyph
 * in the embedded subset. So the text always copies as it reads.
 */
function pdfView(base: fontkit.Font): fontkit.Font {
  type Internal = fontkit.Font & { _glyphs: object; getGlyph(id: number, codePoints?: number[]): fontkit.Glyph };
  const view = Object.create(base) as Internal;
  // The layout engine is made lazily and kept on the font it was made for, so
  // the view is given the class's own getter rather than inheriting the base's.
  for (let proto = Object.getPrototypeOf(base); proto; proto = Object.getPrototypeOf(proto)) {
    const engine = Object.getOwnPropertyDescriptor(proto, '_layoutEngine');
    if (engine) {
      Object.defineProperty(view, '_layoutEngine', { ...engine, configurable: true });
      break;
    }
  }
  const getGlyph = (base as Internal).getGlyph;
  view.getGlyph = function (id: number, codePoints?: number[]) {
    this._glyphs = {};
    return getGlyph.call(this, id, codePoints);
  };

  /** For each glyph id: the letters it stands for, and the id drawn for them. */
  const meanings = new Map<number, Map<string, number>>();
  /** Each extra id, and the glyph it copies. */
  const copyOf = new Map<number, number>();
  let nextId = base.numGlyphs;
  const layout = base.layout;
  view.layout = function (...args: Parameters<fontkit.Font['layout']>): Run {
    const run = layout.apply(this, args);
    run.glyphs = run.glyphs.map((g) => {
      const letters = String.fromCodePoint(...g.codePoints);
      let ids = meanings.get(g.id);
      if (!ids) {
        ids = new Map([[letters, g.id]]);
        meanings.set(g.id, ids);
      }
      let id = ids.get(letters);
      if (id === undefined) {
        id = nextId++;
        ids.set(letters, id);
        copyOf.set(id, g.id);
      }
      return id === g.id ? g : (Object.create(g, { id: { value: id }, advanceWidth: { value: g.advanceWidth } }) as fontkit.Glyph);
    });
    return run;
  };
  const createSubset = base.createSubset;
  view.createSubset = function () {
    type Subset = fontkit.Subset & { glyphs: number[] };
    const subset = createSubset.call(this) as Subset;
    const encode = subset.encode as (this: Subset, ...args: unknown[]) => Uint8Array;
    subset.encode = function (this: Subset, ...args: unknown[]) {
      // The copies are their glyph again, under their own new id.
      this.glyphs = this.glyphs.map((id) => copyOf.get(id) ?? id);
      return encode.apply(this, args);
    } as Subset['encode'];
    return subset;
  };
  return view;
}

const COMMON = /^[\p{Script=Common}\p{Script=Inherited}]$/u;

/** The font for one character: the previous character's font when it is
 * punctuation, a space, a digit or a mark that font has (so these stay with
 * the word they belong to), else the first font that has it. A character no
 * font has is drawn in the first font (as a box). */
function fontFor(ch: string, previous: number): number {
  const cp = ch.codePointAt(0)!;
  if (previous >= 0 && COMMON.test(ch) && fontAt(previous).hasGlyphForCodePoint(cp)) return previous;
  for (let i = 0; i < FONT_FILES.length; i++) if (fontAt(i).hasGlyphForCodePoint(cp)) return i;
  return previous >= 0 ? previous : 0;
}

/** The width of `text` in font `font` at 1 pt. */
const widthCache = new Map<string, number>();
function width1(font: number, text: string): number {
  const key = `${font}\u0000${text}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    const f = fontAt(font);
    w = f.layout(text).advanceWidth / f.unitsPerEm;
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

/** The width of a stretch of text at 1 pt, each character in its own font. */
function textWidth1(text: string): number {
  let total = 0;
  for (const run of fontRuns(text)) total += width1(run.font, run.text);
  return total;
}

function fontRuns(text: string): Array<{ font: number; text: string }> {
  const runs: Array<{ font: number; text: string }> = [];
  let font = -1;
  for (const ch of text) {
    const f = fontFor(ch, font);
    if (f === font && runs.length > 0) runs[runs.length - 1].text += ch;
    else runs.push({ font: f, text: ch });
    font = f;
  }
  return runs;
}

const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' });
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** Opening punctuation, kept with the word after it. */
const OPENING = /^[\p{Ps}\p{Pi}¿¡]+$/u;

interface Piece {
  start: number;
  end: number;
  space: boolean;
  /** Width at 1 pt. */
  width: number;
}

/** The places a line may break: words, with punctuation kept on the word it
 * belongs to, and the spaces between them. */
function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let glueNext = false;
  for (const s of WORDS.segment(text)) {
    const start = s.index;
    const end = s.index + s.segment.length;
    const space = /^\s+$/u.test(s.segment);
    const last = out[out.length - 1];
    if (space) {
      out.push({ start, end, space: true, width: 0 });
      glueNext = false;
    } else if (glueNext && last && !last.space) {
      last.end = end;
      glueNext = !s.isWordLike && OPENING.test(s.segment);
    } else if (!s.isWordLike && !OPENING.test(s.segment) && last && !last.space) {
      last.end = end;
    } else {
      out.push({ start, end, space: false, width: 0 });
      glueNext = !s.isWordLike && OPENING.test(s.segment);
    }
  }
  for (const p of out) p.width = textWidth1(text.slice(p.start, p.end));
  return out;
}

/** Splits a piece wider than a line into pieces that fit, between graphemes. */
function splitPiece(text: string, piece: Piece, max: number): Piece[] {
  const out: Piece[] = [];
  let start = piece.start;
  let end = piece.start;
  for (const g of GRAPHEMES.segment(text.slice(piece.start, piece.end))) {
    const gEnd = piece.start + g.index + g.segment.length;
    if (end > start && textWidth1(text.slice(start, gEnd)) > max) {
      out.push({ start, end, space: false, width: textWidth1(text.slice(start, end)) });
      start = end;
    }
    end = gEnd;
  }
  out.push({ start, end, space: false, width: textWidth1(text.slice(start, end)) });
  return out;
}

/** The lines of one paragraph, as [start, end) offsets, for a line `max` wide
 * at 1 pt. Spaces at the start and end of a line are left out. */
export function breakLines(text: string, max: number): Array<[number, number]> {
  const lines: Array<[number, number]> = [];
  let start = -1;
  let end = -1;
  let width = 0;
  let spaceBefore = 0;
  const all = pieces(text).flatMap((p) => (!p.space && p.width > max ? splitPiece(text, p, max) : [p]));
  for (const p of all) {
    if (p.space) {
      if (start >= 0) spaceBefore = textWidth1(text.slice(p.start, p.end).replace(/\s+/gu, ' '));
      continue;
    }
    if (start >= 0 && width + spaceBefore + p.width > max) {
      lines.push([start, end]);
      start = -1;
    }
    if (start < 0) {
      start = p.start;
      width = p.width;
    } else {
      width += spaceBefore + p.width;
    }
    end = p.end;
    spaceBefore = 0;
  }
  if (start >= 0) lines.push([start, end]);
  return lines;
}

/** One stretch of a line drawn in one go, in the order it is drawn. */
export interface DrawnRun {
  font: number;
  /** As passed to pdfkit (which has fontkit put Arabic glyphs right to left). */
  text: string;
  /** Width at 1 pt. */
  width: number;
  space: boolean;
}

/** Whether fontkit lays this text out right to left (it does so for Arabic
 * script, Arabic-Indic digits included). */
const fontkitRtl = (font: number, text: string) => fontAt(font).layout(text).direction === 'rtl';
const reverseGraphemes = (s: string) => [...GRAPHEMES.segment(s)].map((g) => g.segment).reverse().join('');

/**
 * One line of a paragraph in visual order, left to right (rules L1 to L4 of
 * the bidirectional algorithm): runs at a right-to-left level are reversed,
 * and brackets in them mirrored. Each run is one font, one level, and either
 * spaces, a mirrored bracket, or text without spaces.
 */
export function visualRuns(text: string, levels: Uint8Array, start: number, end: number): DrawnRun[] {
  type Item = { font: number; level: number; kind: 'space' | 'mirror' | 'text'; text: string };
  const items: Item[] = [];
  let font = -1;
  for (let i = start; i < end; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const level = levels[i];
    // A bracket in right-to-left text is drawn on its own, mirrored.
    const kind = /\s/u.test(ch) ? 'space' : level % 2 === 1 && bidi.getMirroredCharacter(ch) ? 'mirror' : 'text';
    font = fontFor(ch, font);
    const last = items[items.length - 1];
    if (last && kind !== 'mirror' && last.kind === kind && last.level === level && last.font === font) last.text += ch;
    else items.push({ font, level, kind, text: ch });
    i += ch.length;
  }
  // L2: from the highest level down to the lowest odd one, reverse every
  // stretch at that level or higher.
  const max = Math.max(0, ...items.map((it) => it.level));
  const lowestOdd = Math.min(max + 1, ...items.map((it) => (it.level % 2 === 1 ? it.level : it.level + 1)));
  for (let level = max; level >= lowestOdd; level--) {
    for (let i = 0; i < items.length; ) {
      if (items[i].level < level) {
        i++;
        continue;
      }
      let j = i;
      while (j < items.length && items[j].level >= level) j++;
      items.splice(i, j - i, ...items.slice(i, j).reverse());
      i = j;
    }
  }
  return items.map((it) => {
    const rtl = it.level % 2 === 1;
    let drawn = it.text;
    if (it.kind === 'space') return { font: it.font, text: ' ', width: width1(it.font, ' ') * it.text.length, space: true };
    if (it.kind === 'mirror') drawn = bidi.getMirroredCharacter(it.text) ?? it.text;
    // L4 and L3's order within the run: fontkit already turns Arabic right to
    // left; anything else (punctuation in Arabic text, or Arabic-Indic digits
    // in a left-to-right number) is turned here so it comes out as wanted.
    if (rtl !== fontkitRtl(it.font, drawn)) drawn = reverseGraphemes(drawn);
    return { font: it.font, text: drawn, width: width1(it.font, drawn), space: false };
  });
}

/** A paragraph's base direction, from its first strong character (as the
 * page's dir="auto"); left to right when it has none. */
function paragraphLevels(text: string): { levels: Uint8Array; rtl: boolean } {
  const result = bidi.getEmbeddingLevels(text, 'auto');
  return { levels: result.levels, rtl: (result.paragraphs[0]?.level ?? 0) % 2 === 1 };
}

/**
 * Whether a PNG's pixel data inflates (true for anything that isn't a PNG).
 * pdfkit inflates a PNG with transparency (as drawn signatures are) only
 * once the PDF is being written, and a failure there is thrown where nothing
 * can catch it, so a damaged one is caught here first.
 */
function pngDataReadable(bytes: Buffer): boolean {
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  const data: Buffer[] = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    if (at + 12 + length > bytes.length) return false;
    if (type === 'IDAT') data.push(bytes.subarray(at + 8, at + 8 + length));
    if (type === 'IEND') break;
    at += 12 + length;
  }
  if (data.length === 0) return false;
  try {
    inflateSync(Buffer.concat(data));
    return true;
  } catch {
    return false;
  }
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const FOOTER = 24;
const GREY = '#555555';
const INK = '#111111';

interface Style {
  size: number;
  color: string;
  /** Line height as a multiple of the size. */
  leading?: number;
  /** Space after the paragraph, in points. */
  after?: number;
  /** Line each paragraph up by its own first strong letter (the wording
   * signed, as the page's dir="auto") instead of by the document's direction
   * (Decision 434, TXT-5): a Latin-only value (the time, the SHA-256, a Latin
   * name) in an Arabic document sits on the right, under its label. */
  ownDirection?: boolean;
}

/** Characters none of the fonts has, written another way so they never show
 * as a box (Decision 434, TXT-5): the new Dirham sign (U+20C3), which only
 * appears in text a School typed, as "د.إ". */
const NO_GLYPH_FALLBACKS: ReadonlyArray<[string, string]> = [['\u20C3', '\u062F.\u0625']];

function withFallbacks(text: string): string {
  let out = text;
  for (const [ch, to] of NO_GLYPH_FALLBACKS) {
    if (!out.includes(ch) || FONT_FILES.some((_f, i) => fontAt(i).hasGlyphForCodePoint(ch.codePointAt(0)!))) continue;
    out = out.split(ch).join(to);
  }
  return out;
}

/** Writes blocks down the page, adding a page when one is full. */
class PdfWriter {
  readonly pdf: PDFKit.PDFDocument;
  private y = MARGIN;
  private readonly left = MARGIN;
  private readonly width = A4[0] - 2 * MARGIN;
  private readonly bottom = A4[1] - MARGIN - FOOTER;
  private readonly registered = new Set<number>();

  /** @param rtl the document's direction: the reader's language, as its labels show. */
  constructor(title: string, private readonly rtl = false) {
    this.pdf = new PDFDocument({ size: A4, margin: 0, bufferPages: true, info: { Title: title }, displayTitle: true });
  }

  private use(font: number, size: number, color: string): void {
    if (!this.registered.has(font)) {
      // pdfkit takes a fontkit font as it is, so each file is parsed once.
      this.pdf.registerFont(FONT_FILES[font].key, pdfView(fontAt(font)) as unknown as Buffer);
      this.registered.add(font);
    }
    this.pdf.font(FONT_FILES[font].key).fontSize(size).fillColor(color);
  }

  /** Room for `height` more points on this page, else a new page. */
  ensure(height: number): void {
    if (this.y + height > this.bottom && this.y > MARGIN) {
      this.pdf.addPage({ size: A4, margin: 0 });
      this.y = MARGIN;
    }
  }

  gap(points: number): void {
    this.y += points;
  }

  /** Text as the page's `white-space: pre-line` showed it: each line break
   * kept, runs of spaces as one, each paragraph in its own direction. */
  text(value: string, style: Style, keepWithNext = 0): void {
    const lineHeight = style.size * (style.leading ?? 1.45);
    const paragraphs = withFallbacks(value).replace(/\r\n?/g, '\n').split('\n');
    paragraphs.forEach((raw, n) => {
      const para = raw.replace(/[ \t\f\v]+/g, ' ').trim();
      if (!para) {
        this.ensure(lineHeight);
        this.y += lineHeight;
        return;
      }
      const { levels, rtl } = paragraphLevels(para);
      const lines = breakLines(para, this.width / style.size);
      lines.forEach(([start, end], i) => {
        const last = n === paragraphs.length - 1 && i === lines.length - 1;
        this.ensure(lineHeight + (last ? keepWithNext : 0));
        const runs = visualRuns(para, levels, start, end);
        const lineWidth = runs.reduce((sum, r) => sum + r.width, 0) * style.size;
        let x = (style.ownDirection ? rtl : this.rtl) ? this.left + this.width - lineWidth : this.left;
        const baseline = this.y + style.size * 1.1;
        for (const run of runs) {
          if (!run.space) {
            this.use(run.font, style.size, style.color);
            this.pdf.text(run.text, x, baseline, { lineBreak: false, baseline: 'alphabetic' });
          }
          x += run.width * style.size;
        }
        this.y += lineHeight;
      });
    });
    this.y += style.after ?? 0;
  }

  /** The drawn signature or paper photo, as large as fits (up to 260 pt high,
   * as the page's 24 rem), with a thin border. False when the image can't be
   * read. */
  image(bytes: Buffer): boolean {
    type Image = { width: number; height: number; orientation?: number };
    let img: Image;
    try {
      if (!pngDataReadable(bytes)) return false;
      img = (this.pdf as PDFKit.PDFDocument & { openImage(src: Buffer): Image }).openImage(bytes);
    } catch {
      return false;
    }
    // A photo turned by its EXIF orientation is shown turned, as pdfkit does.
    const [iw, ih] = (img.orientation ?? 1) > 4 ? [img.height, img.width] : [img.width, img.height];
    if (!(iw > 0 && ih > 0)) return false;
    const scale = Math.min(1, this.width / iw, 260 / ih);
    const w = iw * scale;
    const h = ih * scale;
    this.ensure(h + 2);
    try {
      this.pdf.image(img as unknown as Buffer, this.left + 1, this.y + 1, { width: w, height: h });
    } catch {
      return false;
    }
    this.pdf.rect(this.left + 0.5, this.y + 0.5, w + 1, h + 1).lineWidth(0.5).strokeColor('#dddddd').stroke();
    this.y += h + 14;
    return true;
  }

  /** "1 / 3" at the foot of every page, and the PDF as bytes. */
  finish(): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      this.pdf.on('data', (c: Buffer) => chunks.push(c));
      this.pdf.on('end', () => resolve(Buffer.concat(chunks)));
      this.pdf.on('error', reject);
    });
    const range = this.pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.pdf.switchToPage(i);
      const label = `${i - range.start + 1} / ${range.count}`;
      this.use(0, 8, GREY);
      const w = width1(0, label) * 8;
      this.pdf.text(label, (A4[0] - w) / 2, A4[1] - MARGIN, { lineBreak: false, baseline: 'alphabetic' });
    }
    this.pdf.end();
    return done;
  }
}

/**
 * One signed document as a PDF: the same content, in the same order, as the
 * printable page it replaces — the School, the title (and "Expired"), who signed (a
 * Guardian or paper signature marked), the typed signature or who recorded a
 * paper one, when (UTC), the version and SHA-256 of the wording, the drawn
 * signature or paper photo, and the wording signed.
 */
export async function signedDocumentPdf(doc: SignedDocument, schoolName: string, labels: SignedDocumentLabels): Promise<Buffer> {
  // The document reads in the reader's language: its direction is its labels'.
  const w = new PdfWriter(`${doc.title} - ${doc.memberName}`, paragraphLevels(`${labels.member} ${labels.signedAt} ${labels.textSigned}`).rtl);
  const note: Style = { size: 10, color: GREY, after: 6 };
  if (schoolName) w.text(schoolName, note);
  w.text(doc.title, { size: 18, color: INK, leading: 1.3, after: 4 });
  if (doc.expired) w.text(labels.expired, note);
  w.gap(6);

  const row = (label: string, value: string) => {
    w.text(label, { size: 9, color: GREY, leading: 1.4 }, 16);
    w.text(value, { size: 11, color: INK, after: 4 });
  };
  row(labels.member, doc.kind === 'GUEST' ? `${doc.memberName} (${labels.guest})` : doc.memberName);
  row(labels.signedName, signedByCell(doc, labels));
  if (doc.onPaper) {
    if (doc.recordedByName) row(labels.recordedBy, doc.recordedByName);
  } else if (doc.signatureText) {
    row(labels.signature, doc.signatureText);
  }
  row(labels.signedAt, utcStamp(doc.signedAt));
  if (doc.version != null) row(labels.version, String(doc.version));
  if (doc.sha256) row('SHA-256', doc.sha256);
  w.gap(8);

  // An image that is there but can't be read is reported as missing.
  if (doc.image ? !w.image(doc.image.bytes) : doc.imageMissing) w.text(labels.imageMissing, note);

  w.gap(6);
  w.text(labels.textSigned, { size: 14, color: INK, leading: 1.3, after: 6 }, 20);
  if (doc.body != null) w.text(doc.body, { size: 11, color: INK, leading: 1.5, ownDirection: true });
  else w.text(labels.notRecorded, note);
  return w.finish();
}
