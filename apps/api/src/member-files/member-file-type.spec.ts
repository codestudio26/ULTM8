import { cleanMemberFileName, detectMemberFileType, memberFileTypeOf } from './member-file-type';

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

describe('member file type (backlog 5.11)', () => {
  it('reads PDF, PNG and JPG from their first bytes', () => {
    expect(detectMemberFileType(PDF)).toBe('application/pdf');
    expect(detectMemberFileType(PNG)).toBe('image/png');
    expect(detectMemberFileType(JPG)).toBe('image/jpeg');
  });

  it('refuses anything else, however it is named', () => {
    expect(detectMemberFileType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectMemberFileType(Buffer.from('<html><body>'))).toBeNull();
    expect(detectMemberFileType(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBeNull(); // a ZIP / .docx
    expect(detectMemberFileType(Buffer.alloc(0))).toBeNull();
    expect(memberFileTypeOf(Buffer.from('MZ\x90\x00'), 'contract.pdf')).toBeNull();
  });

  it('needs the name to agree with the content', () => {
    expect(memberFileTypeOf(PDF, 'Contract.PDF')).toBe('application/pdf');
    expect(memberFileTypeOf(JPG, 'photo.jpeg')).toBe('image/jpeg');
    expect(memberFileTypeOf(JPG, 'photo.jpg')).toBe('image/jpeg');
    expect(memberFileTypeOf(PNG, 'scan.png')).toBe('image/png');
    expect(memberFileTypeOf(PNG, 'scan.pdf')).toBeNull();
    expect(memberFileTypeOf(PDF, 'contract.exe')).toBeNull();
    expect(memberFileTypeOf(PDF, 'contract')).toBeNull();
  });

  it('keeps a clean name: no folders or control characters, UTF-8 read back', () => {
    expect(cleanMemberFileName('C:\\Users\\me\\Medical note.pdf')).toBe('Medical note.pdf');
    expect(cleanMemberFileName('../../etc/passwd.png')).toBe('passwd.png');
    expect(cleanMemberFileName('a\u0000b\u001fc.pdf')).toBe('abc.pdf');
    expect(cleanMemberFileName(Buffer.from('Atestado médico.pdf', 'utf8').toString('latin1'))).toBe('Atestado médico.pdf');
    expect(cleanMemberFileName('健康診断.pdf')).toBe('健康診断.pdf');
    const long = cleanMemberFileName(`${'x'.repeat(300)}.pdf`);
    expect(long).toHaveLength(200);
    expect(long.endsWith('.pdf')).toBe(true);
  });
});
