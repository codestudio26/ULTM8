import { describe, expect, it } from '@jest/globals';
import { batches, cellValue, detectDelimiter, markRepeats, parseCsv, readImportFile, templateCsv } from './csv';

describe('reading an import file (Decision 315 items 12, 13)', () => {
  it('reads quoted cells, doubled quotes, line breaks and a byte-order mark', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n1,2,3';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'two\nlines'],
      ['1', '2', '3'],
    ]);
  });

  it('reads a file saved with semicolons or tabs', () => {
    expect(detectDelimiter('first_name;last_name;email\nA;B;c@d.test')).toBe(';');
    expect(detectDelimiter('first_name\tlast_name')).toBe('\t');
    expect(detectDelimiter('email')).toBe(',');
    expect(parseCsv('first_name;belts\nAna;"BJJ: Blue; Judo: Yellow"')).toEqual([
      ['first_name', 'belts'],
      ['Ana', 'BJJ: Blue; Judo: Yellow'],
    ]);
  });

  it('maps cells to the import columns by header, as the API names them', () => {
    const parsed = readImportFile('First Name,EMAIL,Shoe size\nAna , ana@x.test,42\nBen,ben@x.test', ['first_name', 'last_name', 'email']);
    expect(parsed.rows).toEqual([
      { rowNumber: 2, values: { first_name: 'Ana', email: 'ana@x.test' } },
      { rowNumber: 3, values: { first_name: 'Ben', email: 'ben@x.test' } },
    ]);
    expect(parsed.unknownColumns).toEqual(['shoe_size']);
    expect(parsed.missingColumns).toEqual(['last_name']);
  });

  it("drops the apostrophe our own exports put before a +, so a phone number round-trips", () => {
    expect(cellValue("'+44 7911 123456")).toBe('+44 7911 123456');
    expect(cellValue("O'Neil")).toBe("O'Neil");
    const template = templateCsv(['first_name', 'phone'], { first_name: 'Ana', phone: '+44 7911 123456' });
    expect(readImportFile(template, ['first_name', 'phone']).rows[0].values).toEqual({ first_name: 'Ana', phone: '+44 7911 123456' });
  });

  it('marks a row repeated from an earlier batch as the import will: skipped', () => {
    const rows = [
      { rowNumber: 2, values: { email: 'a@x.test', date: '2026-10-01', time: '18:00', class: 'BJJ' } },
      { rowNumber: 3, values: { email: 'A@x.test ', date: '2026-10-01', time: '18:00', class: 'bjj' } },
      { rowNumber: 4, values: { email: 'b@x.test', date: '2026-10-01', time: '18:00', class: 'BJJ' } },
    ];
    const results = rows.map((r) => ({ rowNumber: r.rowNumber, outcome: 'READY', code: 'NEW_ATTENDANCE', column: null as string | null, message: '' }));
    markRepeats('ATTENDANCE', rows, results);
    expect(results.map((r) => [r.outcome, r.code])).toEqual([
      ['READY', 'NEW_ATTENDANCE'],
      ['SKIPPED', 'DUPLICATE_IN_FILE'],
      ['READY', 'NEW_ATTENDANCE'],
    ]);
  });

  it('sends rows in batches', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 2)).toEqual([]);
  });
});
