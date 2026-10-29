import type { components } from '@ultm8/api-client';
import type { TranslateFn } from '../i18n/I18nProvider';
import { csvCell } from '../transactions/transactionsCsv';

export type StudentExportRow = components['schemas']['StudentExportRowDto'];
export type StudentExportFilter = components['schemas']['StudentExportFilter'];

/** Whole years since `dateOfBirth` (YYYY-MM-DD), or blank. */
export function ageOn(dateOfBirth: string | null | undefined, today = new Date()): string {
  if (!dateOfBirth) return '';
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age >= 0 ? String(age) : '';
}

/**
 * The student list as table rows (backlog 3.9, Decision 399): one header row
 * in the reader's language, then one row per student. Dates are YYYY-MM-DD;
 * a list (memberships, belts, Guardians) is joined with "; ".
 */
export function studentExportTable(t: TranslateFn, rows: StudentExportRow[], withBranch: boolean): string[][] {
  const c = (k: string) => t(`students.export.columns.${k}` as Parameters<TranslateFn>[0]);
  const headers = [
    c('firstName'), c('surname'), c('email'), c('phone'), c('dateOfBirth'), c('age'), c('status'), c('joined'),
    ...(withBranch ? [c('branch')] : []),
    c('visitor'), c('memberships'), c('billing'), c('belts'), c('lastVisit'), c('guardian'), c('guardianEmail'),
  ];
  const billing = { ACTIVE: t('students.export.billingActive'), EXPIRED: t('students.export.billingExpired'), NONE: t('students.export.billingNone') };
  const body = rows.map((r) => [
    r.firstName,
    r.surname,
    r.email,
    r.phone ?? '',
    r.dateOfBirth ?? '',
    ageOn(r.dateOfBirth),
    r.status === 'ACTIVE' ? t('students.export.statusActive') : t('students.export.statusFormer'),
    r.enrolledAt.slice(0, 10),
    ...(withBranch ? [r.homeBranchName ?? ''] : []),
    r.visitor ? t('students.export.yes') : t('students.export.no'),
    r.memberships.join('; '),
    billing[r.billingStatus],
    r.belts.map((b) => `${b.style}: ${b.rank}`).join('; '),
    r.lastVisitAt ? r.lastVisitAt.slice(0, 10) : '',
    r.guardians.map((g) => g.name).join('; '),
    r.guardians.map((g) => g.email).join('; '),
  ]);
  return [headers, ...body];
}

/** As CSV, with the byte-order mark Excel needs for accented names. */
export function studentExportCsv(table: string[][]): string {
  return `﻿${table.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

/** A printable page of the same table, with a Print button the printout hides. */
export function studentExportHtml(t: TranslateFn, schoolName: string, table: string[][]): string {
  const [headers, ...rows] = table;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${esc(t('students.export.printTitle', { school: schoolName }))}</title>` +
    '<style>body{font-family:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;margin:32px;color:#151719}' +
    'h1{font-size:18px;margin:0 0 12px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e1e3e5;font-size:11px;vertical-align:top}' +
    'th{font-size:10px;text-transform:uppercase;color:#50575e}button{margin-top:20px;padding:10px 16px;border-radius:8px;border:1px solid #5d7081;background:#5d7081;color:#fff;font-weight:600;cursor:pointer}' +
    '@media print{button{display:none}body{margin:0}}</style></head><body>' +
    `<h1>${esc(t('students.export.printTitle', { school: schoolName }))}</h1>` +
    `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` +
    `<button onclick="window.print()">${esc(t('students.export.printButton'))}</button></body></html>`
  );
}
