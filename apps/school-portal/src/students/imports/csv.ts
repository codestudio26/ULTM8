import { csvCell } from '../../transactions/transactionsCsv';

/**
 * Reading a spreadsheet saved as CSV for Students → Import (Decision 315
 * items 12, 13). The API checks every value again; this only turns the file
 * into rows of cells by column.
 */

/** A header as typed ("First name", "first-name") → first_name, as the API reads it. */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** The separator the file uses: a comma, or the semicolon (or tab) a
 * spreadsheet set to a language with decimal commas saves with. Read from the
 * header line. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const counts: Array<[',' | ';' | '\t', number]> = [
    [',', count(',')],
    [';', count(';')],
    ['\t', count('\t')],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** RFC 4180 CSV: quoted cells may hold the separator, quotes ("") and line
 * breaks. A byte-order mark is dropped; blank lines are skipped. */
export function parseCsv(text: string, delimiter: string = detectDelimiter(text.replace(/^﻿/, ''))): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** A cell as written: our own exports guard a leading =, +, - or @ with an
 * apostrophe so a spreadsheet doesn't run it; that apostrophe is dropped. */
export function cellValue(raw: string): string {
  const value = raw.trim();
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

export interface ParsedImport {
  /** Each data row: its line in the file (the header is line 1) and its cells by column. */
  rows: Array<{ rowNumber: number; values: Record<string, string> }>;
  /** Header columns the import doesn't know (ignored). */
  unknownColumns: string[];
  /** Template columns the file doesn't have. */
  missingColumns: string[];
}

/** The file's rows, by the import's own columns. Line numbers count the
 * header as line 1, as a spreadsheet shows them (blank lines skipped). */
export function readImportFile(text: string, columns: readonly string[]): ParsedImport {
  const [header = [], ...body] = parseCsv(text);
  const names = header.map(normalizeHeader);
  const known = new Set(columns);
  return {
    rows: body.map((cells, i) => ({
      rowNumber: i + 2,
      values: Object.fromEntries(names.map((name, c) => [name, cellValue(cells[c] ?? '')]).filter(([name]) => known.has(name))),
    })),
    unknownColumns: names.filter((n) => n && !known.has(n)),
    missingColumns: columns.filter((c) => !names.includes(c)),
  };
}

/** The template: the header row and one example row, as CSV with the
 * byte-order mark Excel needs for accented names. */
export function templateCsv(columns: readonly string[], example: Record<string, string>): string {
  const lines = [columns.join(','), columns.map((c) => csvCell(example[c] ?? '')).join(',')];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** The cells that make two rows the same row, per kind. */
const SAME_ROW: Record<string, readonly string[]> = {
  MEMBERS: ['email', 'guardian_email', 'first_name', 'last_name', 'date_of_birth'],
  MEMBERSHIPS: ['email', 'first_name', 'last_name', 'plan', 'start_date'],
  ATTENDANCE: ['email', 'first_name', 'last_name', 'date', 'time', 'class'],
};

/**
 * The preview is checked in batches, and the API finds a row repeated within
 * one batch only. A row the same as one in an earlier batch is marked here
 * as the import will treat it: skipped as a repeat.
 */
export function markRepeats<R extends { rowNumber: number; outcome: string; code: string; column: string | null; message: string }>(
  kind: string,
  rows: Array<{ rowNumber: number; values: Record<string, string> }>,
  results: R[],
): void {
  const cells = SAME_ROW[kind] ?? [];
  const seen = new Set<string>();
  const byRow = new Map(results.map((r) => [r.rowNumber, r]));
  for (const row of rows) {
    const key = cells.map((c) => (row.values[c] ?? '').trim().toLowerCase()).join('\u0000');
    const result = byRow.get(row.rowNumber);
    if (seen.has(key) && result?.outcome === 'READY') {
      Object.assign(result, { outcome: 'SKIPPED', code: 'DUPLICATE_IN_FILE', column: null, message: 'The same as an earlier row of the file.' });
    }
    seen.add(key);
  }
}

/** Splits rows into batches of at most `size`. */
export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
