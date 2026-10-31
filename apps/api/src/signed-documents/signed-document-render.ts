import type { SignedDocumentLabels } from './dto/signed-documents.dto';

/** One signed document in the export: a member's waiver signature, or a
 * guest's (Decision 351). */
export interface SignedDocument {
  id: string;
  kind: 'MEMBER' | 'GUEST';
  memberName: string;
  title: string;
  version: number | null;
  /** The wording as signed; null for signatures from before copies were kept. */
  body: string | null;
  sha256: string | null;
  signedAt: Date;
  /** The typed name. */
  signerName: string;
  signatureText: string | null;
  byGuardian: boolean;
  onPaper: boolean;
  recordedByName: string | null;
  expired: boolean;
  image: { bytes: Buffer; contentType: string } | null;
  /** The record says there is an image, but it couldn't be read from storage. */
  imageMissing: boolean;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

/** A CSV cell: quoted when it holds a comma, quote or line break, and never
 * read as a formula (the portal's csvCell rule). */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A date and time in UTC, the same for every reader: 2026-10-31 14:03 UTC. */
export const utcStamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The image's type from its first bytes: PNG or JPEG, else null. */
export function imageTypeOf(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/** A file name safe on every system, from the member and the document. */
export function documentFileName(index: number, doc: SignedDocument): string {
  const clean = (s: string) =>
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || '_';
  return `documents/${String(index).padStart(5, '0')} ${clean(doc.memberName)} - ${clean(doc.title)}.html`;
}

/** Who signed, for the index: the typed name, marked when a Guardian signed
 * for a child or it was signed on paper. */
export function signedByCell(doc: SignedDocument, labels: SignedDocumentLabels): string {
  const marks = [doc.byGuardian ? labels.guardian : null, doc.onPaper ? labels.onPaper : null].filter(Boolean);
  return marks.length > 0 ? `${doc.signerName} (${marks.join(', ')})` : doc.signerName;
}

/** The index: one row per document, in the order of the files. */
export function indexCsv(rows: Array<{ doc: SignedDocument; file: string }>, labels: SignedDocumentLabels): Buffer {
  const header = [labels.member, labels.document, labels.version, labels.signedAt, labels.signedBy, labels.file];
  const lines = [header, ...rows.map(({ doc, file }) => [
    doc.kind === 'GUEST' ? `${doc.memberName} (${labels.guest})` : doc.memberName,
    doc.expired ? `${doc.title} (${labels.expired})` : doc.title,
    doc.version == null ? '' : String(doc.version),
    utcStamp(doc.signedAt),
    signedByCell(doc, labels),
    file,
  ])];
  // A byte-order mark, so spreadsheet apps read the names as UTF-8.
  return Buffer.from(`\ufeff${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8');
}

/**
 * One signed document as a page that opens in any browser and prints to PDF:
 * what the Waivers page shows for a signature (who, when, the typed and
 * drawn signature, and the wording signed), with the image inside the file.
 */
export function signedDocumentHtml(doc: SignedDocument, schoolName: string, labels: SignedDocumentLabels): Buffer {
  const row = (label: string, value: string) => `<dt>${escapeHtml(label)}</dt><dd dir="auto">${escapeHtml(value)}</dd>`;
  const parts = [
    row(labels.member, doc.kind === 'GUEST' ? `${doc.memberName} (${labels.guest})` : doc.memberName),
    row(labels.signedName, signedByCell(doc, labels)),
  ];
  if (doc.onPaper) {
    if (doc.recordedByName) parts.push(row(labels.recordedBy, doc.recordedByName));
  } else if (doc.signatureText) {
    parts.push(row(labels.signature, doc.signatureText));
  }
  parts.push(row(labels.signedAt, utcStamp(doc.signedAt)));
  if (doc.version != null) parts.push(row(labels.version, String(doc.version)));
  if (doc.sha256) parts.push(row('SHA-256', doc.sha256));

  const image = doc.image
    ? `<p><img alt="${escapeHtml(labels.signature)}" src="data:${doc.image.contentType};base64,${doc.image.bytes.toString('base64')}"></p>`
    : doc.imageMissing
      ? `<p class="note">${escapeHtml(labels.imageMissing)}</p>`
      : '';
  const body = doc.body != null ? `<div class="text" dir="auto">${escapeHtml(doc.body)}</div>` : `<p class="note">${escapeHtml(labels.notRecorded)}</p>`;

  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${escapeHtml(`${doc.title} - ${doc.memberName}`)}</title>` +
    '<style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#111}' +
    'dt{font-size:.8rem;color:#555;margin-top:.6rem}dd{margin:0}img{max-width:100%;max-height:24rem;background:#fff;border:1px solid #ddd}' +
    '.text{white-space:pre-line;border:1px solid #ddd;padding:1rem;line-height:1.6}.note{color:#555}</style></head><body>' +
    `<p class="note" dir="auto">${escapeHtml(schoolName)}</p>` +
    `<h1 dir="auto">${escapeHtml(doc.title)}</h1>` +
    (doc.expired ? `<p class="note">${escapeHtml(labels.expired)}</p>` : '') +
    `<dl>${parts.join('')}</dl>${image}` +
    `<h2>${escapeHtml(labels.textSigned)}</h2>${body}` +
    '</body></html>';
  return Buffer.from(html, 'utf8');
}
