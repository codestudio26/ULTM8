import { inflateSync } from 'zlib';

/** One piece of text drawn on a page, in the order the PDF draws it. */
export interface PdfTextBlock {
  /** 1 for the first page. */
  page: number;
  /** Where it starts, in points from the left and from the top of the page. */
  x: number;
  y: number;
  /** Each glyph's text, from the font's Unicode map, left to right as drawn. */
  glyphs: string[];
  text: string;
}

/**
 * Reads back the text of a PDF made by pdfkit, the way a PDF reader does for
 * copying or searching: each glyph through its font's Unicode map
 * (ToUnicode). For the specs: the signed-documents export's PDFs (Decision
 * 422 item 10) are checked by reading them. Handles only what pdfkit writes
 * (Flate streams, direct lengths, one content stream per page, text shown
 * with TJ in Identity-H fonts); not a general PDF parser.
 */
export function readPdfText(pdf: Buffer): { pages: number; blocks: PdfTextBlock[] } {
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Not a PDF.');
  const objects = new Map<number, { dict: string; stream: Buffer | null }>();
  const src = pdf.toString('latin1');
  const header = /(\d+) 0 obj\b/g;
  for (let m = header.exec(src); m; m = header.exec(src)) {
    const start = m.index + m[0].length;
    const streamAt = src.indexOf('stream', start);
    const endAt = src.indexOf('endobj', start);
    if (streamAt >= 0 && streamAt < endAt) {
      const dict = src.slice(start, streamAt);
      const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0);
      const dataAt = streamAt + 'stream'.length + (src[streamAt + 6] === '\r' ? 2 : 1);
      const raw = pdf.subarray(dataAt, dataAt + length);
      objects.set(Number(m[1]), { dict, stream: dict.includes('/FlateDecode') ? inflateSync(raw) : raw });
      header.lastIndex = src.indexOf('endobj', dataAt + length);
    } else {
      objects.set(Number(m[1]), { dict: src.slice(start, endAt), stream: null });
      header.lastIndex = endAt;
    }
  }
  const ref = (dict: string, key: string) => {
    const r = new RegExp(`/${key} (\\d+) 0 R`).exec(dict);
    return r ? objects.get(Number(r[1])) : undefined;
  };

  // Each font resource name (F1, F2, ...; pdfkit's are unique in a document)
  // and its Unicode map.
  const unicode = new Map<string, Map<number, string>>();
  for (const { dict } of objects.values()) {
    for (const fonts of dict.matchAll(/\/Font\s*<<([^>]*)>>/g)) {
      for (const [, name, num] of fonts[1].matchAll(/\/(\w+) (\d+) 0 R/g)) {
        if (unicode.has(name)) continue;
        const cmap = ref(objects.get(Number(num))?.dict ?? '', 'ToUnicode')?.stream?.toString('latin1') ?? '';
        unicode.set(name, parseToUnicode(cmap));
      }
    }
  }

  const pagesDict = [...objects.values()].find((o) => /\/Type \/Pages\b/.test(o.dict))?.dict ?? '';
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(pagesDict)?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((k) => Number(k[1]));
  const blocks: PdfTextBlock[] = [];
  kids.forEach((num, i) => {
    const content = ref(objects.get(num)?.dict ?? '', 'Contents')?.stream?.toString('latin1') ?? '';
    let font = '';
    let block: PdfTextBlock | null = null;
    const ops = /\bBT\b|\bET\b|(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm|\/(\w+) [\d.]+ Tf|\[([^\]]*)\] TJ/g;
    for (const op of content.matchAll(ops)) {
      if (op[0] === 'BT') block = null;
      else if (op[0] === 'ET') {
        if (block) blocks.push({ ...block, text: block.glyphs.join('') });
        block = null;
      } else if (op[7]) font = op[7];
      else if (op[5] !== undefined && !block) block = { page: i + 1, x: Number(op[5]), y: Number(op[6]), glyphs: [], text: '' };
      else if (op[8] !== undefined && block) {
        const map = unicode.get(font);
        for (const [, hex] of op[8].matchAll(/<([0-9a-fA-F]*)>/g)) {
          for (let at = 0; at + 4 <= hex.length; at += 4) block.glyphs.push(map?.get(parseInt(hex.slice(at, at + 4), 16)) ?? '�');
        }
      }
    }
  });
  return { pages: kids.length, blocks };
}

/** A ToUnicode CMap's glyph → text pairs (bfchar and bfrange, both forms). */
function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const text = (hex: string) => String.fromCharCode(...(hex.replace(/\s+/g, '').match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));
  for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, from, to] of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F\s]*)>/g)) map.set(parseInt(from, 16), text(to));
  }
  for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, list, single] of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:\[([^\]]*)\]|<([0-9a-fA-F\s]*)>)/g)) {
      const first = parseInt(lo, 16);
      const last = parseInt(hi, 16);
      if (list !== undefined) {
        [...list.matchAll(/<([0-9a-fA-F\s]*)>/g)].forEach((v, k) => map.set(first + k, text(v[1])));
      } else {
        const base = text(single);
        for (let gid = first; gid <= last; gid++) {
          map.set(gid, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + gid - first));
        }
      }
    }
  }
  return map;
}
