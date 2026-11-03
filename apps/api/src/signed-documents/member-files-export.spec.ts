import { memberFileZipName, memberFolderName, safePathPart, uniqueName } from './member-files-export';

/** Decision 422 item 9: member files in the export ZIP get safe names. */
describe('member file names in the export ZIP', () => {
  it('never lets a name leave its folder', () => {
    for (const raw of ['../../etc/passwd', '..\\..\\boot.ini', '/abs/path.pdf', 'C:\\x.pdf', '..', '.', '...']) {
      const part = safePathPart(raw, 120);
      expect(part).not.toMatch(/[\\/:]/);
      expect(part).not.toBe('.');
      expect(part).not.toBe('..');
      expect(part.startsWith('.')).toBe(false);
    }
    expect(safePathPart('../../etc/passwd', 120)).toBe('_.._etc_passwd');
    expect(safePathPart('..', 120)).toBe('_');
  });

  it('removes characters Windows refuses, control and text-direction characters', () => {
    expect(safePathPart('a<b>c:d"e|f?g*h.pdf', 120)).toBe('a_b_c_d_e_f_g_h.pdf');
    expect(safePathPart('bad\u0000\u001fname.pdf', 120)).toBe('bad__name.pdf');
    // "invoice‮fdp.exe" would show as "invoiceexe.pdf".
    expect(safePathPart('invoice\u202efdp.exe', 120)).toBe('invoice_fdp.exe');
    expect(safePathPart('  spaced   out  .pdf. ', 120)).toBe('spaced out .pdf');
  });

  it('renames reserved Windows names and shortens long ones, keeping the extension', () => {
    expect(safePathPart('CON', 120)).toBe('_CON');
    expect(safePathPart('nul.pdf', 120)).toBe('_nul.pdf');
    const long = safePathPart(`${'x'.repeat(300)}.pdf`, 120);
    expect(long).toHaveLength(120);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it("ends each file in its type's extension", () => {
    expect(memberFileZipName('Scan.PDF', 'application/pdf')).toBe('Scan.PDF');
    expect(memberFileZipName('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg');
    expect(memberFileZipName('photo', 'image/png')).toBe('photo.png');
    expect(memberFileZipName('../evil.sh', 'application/pdf')).toBe('_evil.sh.pdf');
  });

  it("names a member's folder by name and the start of their id", () => {
    expect(memberFolderName('Ana Lima', '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed')).toBe('Ana Lima-1b9d6bcd');
    expect(memberFolderName('../Ana', '1b9d6bcd-bbfd')).toBe('_Ana-1b9d6bcd');
    expect(memberFolderName('', 'abc')).toBe('_-abc');
  });

  it('keeps two files of the same name apart, ignoring case', () => {
    const taken = new Set<string>();
    expect(uniqueName('Scan.pdf', taken)).toBe('Scan.pdf');
    expect(uniqueName('scan.pdf', taken)).toBe('scan (2).pdf');
    expect(uniqueName('Scan.pdf', taken)).toBe('Scan (3).pdf');
    expect(uniqueName('noext', taken)).toBe('noext');
    expect(uniqueName('noext', taken)).toBe('noext (2)');
  });
});
