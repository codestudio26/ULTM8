import type { TransactionResponse } from './transactionQueries';

/**
 * The Transactions page's CSV export (Decision 346, G3): every row the page's
 * filters pick out, not just the page on screen. Amounts are written as plain
 * numbers with two decimals (they are stored in hundredths) and the currency in
 * its own column, so a spreadsheet can add them up. Dates are ISO 8601 (UTC).
 */
export interface CsvLabels {
  headers: string[];
  item: (row: TransactionResponse) => string;
  student: (row: TransactionResponse) => string;
  kind: (row: TransactionResponse) => string;
  status: (row: TransactionResponse) => string;
  method: (row: TransactionResponse) => string;
}

/** Quotes a cell when it holds a comma, quote or line break, and stops a
 * spreadsheet reading a leading =, +, - or @ as a formula. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const money = (minor: number | null | undefined) => (minor == null ? '' : (minor / 100).toFixed(2));

export function transactionsCsv(rows: TransactionResponse[], labels: CsvLabels): string {
  const lines = [labels.headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.billingDate,
        labels.student(row),
        labels.item(row),
        labels.kind(row),
        money(row.amount),
        money(row.surchargeAmount),
        row.currency ?? '',
        labels.status(row),
        labels.method(row),
        money(row.refundedAmount),
        money(row.disputedAmount),
        row.id,
        // Decision 338 item 1: a cancelled payment's when, who and why (staff only).
        row.cancelledAt ?? '',
        row.cancelledByName ?? '',
        row.cancelReason ?? '',
      ]
        .map((v) => csvCell(String(v)))
        .join(','),
    );
  }
  // A byte-order mark so Excel opens accented names and other alphabets correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
