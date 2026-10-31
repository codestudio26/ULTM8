/**
 * Files on a member (backlog 5.11, Decision 315 item 9): PDF, JPG and PNG, up
 * to 10 MB each. The type is read from the file's first bytes, not from its
 * name or the browser's Content-Type, and the name's extension must agree.
 */

export const MEMBER_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type MemberFileContentType = 'application/pdf' | 'image/jpeg' | 'image/png';

const EXTENSIONS: Record<MemberFileContentType, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Buffer, signature: number[]) => bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);

/** The file's type from its first bytes, or null when it is none of the three. */
export function detectMemberFileType(bytes: Buffer): MemberFileContentType | null {
  if (startsWith(bytes, PDF_SIGNATURE)) return 'application/pdf';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
}

/** The type of an upload whose content and name's extension agree, or null. */
export function memberFileTypeOf(bytes: Buffer, fileName: string): MemberFileContentType | null {
  const type = detectMemberFileType(bytes);
  if (!type) return null;
  const dot = fileName.lastIndexOf('.');
  const extension = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  return EXTENSIONS[type].includes(extension) ? type : null;
}

/** The extension the stored object gets. */
export function memberFileExtension(type: MemberFileContentType): string {
  return EXTENSIONS[type][0];
}

/**
 * The name to keep: no folders, no control characters, at most 200
 * characters (the extension kept). Browsers send a UTF-8 name that the
 * multipart parser reads as Latin-1; it is read back as UTF-8 when it fits.
 */
export function cleanMemberFileName(raw: string): string {
  let name = raw;
  // eslint-disable-next-line no-control-regex
  if (/^[\u0000-ÿ]*$/.test(name)) {
    const utf8 = Buffer.from(name, 'latin1').toString('utf8');
    if (!utf8.includes('�')) name = utf8;
  }
  name = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (name.length > 200) {
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, 200 - extension.length) + extension;
  }
  return name;
}
