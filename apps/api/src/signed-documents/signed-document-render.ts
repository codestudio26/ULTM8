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
  /** Decision 435 item 32: the child signed themselves, in their parent's
   * app (Decision 318 item 8; WaiverSignature.signedViaGuardianId). */
  byChildInParentApp: boolean;
  onPaper: boolean;
  recordedByName: string | null;
  expired: boolean;
  image: { bytes: Buffer; contentType: string } | null;
  /** The record says there is an image, but it couldn't be read from storage. */
  imageMissing: boolean;
}

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

/** A file name safe on every system, from the member and the document: the
 * document's PDF (Decision 422 item 10). */
export function documentFileName(index: number, doc: SignedDocument): string {
  const clean = (s: string) =>
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || '_';
  return `documents/${String(index).padStart(5, '0')} ${clean(doc.memberName)} - ${clean(doc.title)}.pdf`;
}

/** Who signed, for the index and the document: the typed name, marked when a
 * Guardian signed for a child, the child signed in their parent's app
 * (Decision 435 item 32), or it was signed on paper. */
export function signedByCell(doc: SignedDocument, labels: SignedDocumentLabels): string {
  const marks = [
    doc.byGuardian ? labels.guardian : null,
    doc.byChildInParentApp ? labels.childInParentApp : null,
    doc.onPaper ? labels.onPaper : null,
  ].filter(Boolean);
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
