import { isEmail, isPhoneNumber } from 'class-validator';
import { isBirthDate } from '../common/decorators/is-birth-date.decorator';

/**
 * Spreadsheet imports (Decision 315 items 12 and 13; backlog 5.13): the
 * three kinds, their columns, and the plain checks on one row's values. The
 * checks against the School's own data (accounts, branches, styles, plans,
 * classes) are in DataImportsService.
 */

export const IMPORT_KINDS = ['MEMBERS', 'MEMBERSHIPS', 'ATTENDANCE'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** At most this many rows in one import (one file). */
export const MAX_IMPORT_ROWS = 2000;
/** At most this many rows in one request; the portal sends a file in batches. */
export const MAX_ROWS_PER_REQUEST = 100;
/** The longest value a cell may hold. */
export const MAX_CELL_LENGTH = 200;

/** Each kind's columns, as the template's header row has them. */
export const IMPORT_COLUMNS: Record<ImportKind, readonly string[]> = {
  MEMBERS: [
    'first_name',
    'last_name',
    'email',
    'phone',
    'date_of_birth',
    'gender',
    'join_date',
    'belts',
    'branch',
    'guardian_email',
    'guardian_first_name',
    'guardian_last_name',
  ],
  // A child has no email of their own: their Guardian's email and the child's name.
  MEMBERSHIPS: ['email', 'first_name', 'last_name', 'plan', 'start_date', 'end_date', 'classes_left'],
  ATTENDANCE: ['email', 'first_name', 'last_name', 'date', 'time', 'class'],
};

/** Why a row is skipped or refused, or what will be done. The portal has its
 * own wording for each; FAILED carries the API's own message instead. */
export const IMPORT_ROW_CODES = [
  // Ready
  'NEW_MEMBER',
  'NEW_CHILD_NEW_GUARDIAN',
  'NEW_CHILD_GUARDIAN_INVITED',
  'NEW_MEMBERSHIP',
  'NEW_ATTENDANCE',
  // Skipped
  'EMAIL_EXISTS',
  'DUPLICATE_IN_FILE',
  'INVITE_PENDING',
  'ALREADY_MEMBER',
  'ALREADY_IMPORTED',
  'ALREADY_ATTENDED',
  // Errors
  'MISSING_VALUE',
  'TOO_LONG',
  'INVALID_EMAIL',
  'INVALID_PHONE',
  'INVALID_DATE',
  'INVALID_BIRTH_DATE',
  'FUTURE_DATE',
  'INVALID_GENDER',
  'INVALID_TIME',
  'INVALID_NUMBER',
  'BRANCH_REQUIRED',
  'NO_BRANCHES',
  'UNKNOWN_BRANCH',
  'NOT_YOUR_BRANCH',
  'BELTS_FORMAT',
  'BELTS_OFF',
  'UNKNOWN_STYLE',
  'UNKNOWN_BELT',
  'GUARDIAN_NAME_REQUIRED',
  'GUARDIAN_UNDER_18',
  'CHILD_OWNER_ONLY',
  'NOT_A_MEMBER',
  'AMBIGUOUS_MEMBER',
  'UNKNOWN_PLAN',
  'AMBIGUOUS_PLAN',
  'PLAN_IS_SUBSCRIPTION',
  'PLAN_NOT_IMPORTABLE',
  'NOT_A_CLASS_PACK',
  'END_BEFORE_START',
  'WAIVER_NEEDED',
  'GENERAL_ACCESS_CONFLICT',
  'UNKNOWN_CLASS',
  'AMBIGUOUS_CLASS',
  'CLASS_CANCELLED',
  'CLASS_NOT_STARTED',
  'OUT_OF_RANGE',
  'FAILED',
] as const;
export type ImportRowCode = (typeof IMPORT_ROW_CODES)[number];

/** Done, with a caveat. */
export const IMPORT_WARNING_CODES = ['BELT_NOT_SET', 'BELTS_AFTER_ACCEPT', 'CHILD_PHONE_NOT_USED', 'EMAIL_NOT_SENT'] as const;
export type ImportWarningCode = (typeof IMPORT_WARNING_CODES)[number];

/** READY only in a preview; CREATED only once imported. */
export type ImportRowOutcome = 'READY' | 'CREATED' | 'SKIPPED' | 'ERROR';

export interface ImportWarning {
  code: ImportWarningCode;
  /** English, for the log. */
  message: string;
  /** BELT_NOT_SET: the style. */
  style?: string;
  /** BELT_NOT_SET: why, in the API's own words. */
  reason?: string;
}

export interface ImportRowResult {
  rowNumber: number;
  outcome: ImportRowOutcome;
  code: ImportRowCode;
  /** The column the problem is in, when it is one column. */
  column: string | null;
  /** English, for the log and for FAILED (the API's own reason). */
  message: string;
  warnings: ImportWarning[];
}

/** A refusal or skip found while checking a row. */
export class RowProblem extends Error {
  constructor(
    readonly outcome: 'SKIPPED' | 'ERROR',
    readonly code: ImportRowCode,
    message: string,
    readonly column: string | null = null,
  ) {
    super(message);
  }
}

export const rowError = (code: ImportRowCode, message: string, column: string | null = null) => new RowProblem('ERROR', code, message, column);
export const rowSkip = (code: ImportRowCode, message: string, column: string | null = null) => new RowProblem('SKIPPED', code, message, column);

/** A header as typed ("First name", "first-name", " FIRST_NAME ") → first_name. */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** One row's cells, by normalized column name, trimmed. */
export class RowValues {
  private readonly cells = new Map<string, string>();

  constructor(values: Record<string, unknown>) {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      this.cells.set(normalizeHeader(key), String(value).trim());
    }
  }

  /** The cell, or '' when blank or missing. 400-free: too long is a row error. */
  get(column: string): string {
    const value = this.cells.get(column) ?? '';
    if (value.length > MAX_CELL_LENGTH) throw rowError('TOO_LONG', `${column} is longer than ${MAX_CELL_LENGTH} characters.`, column);
    return value;
  }

  required(column: string): string {
    const value = this.get(column);
    if (!value) throw rowError('MISSING_VALUE', `${column} is empty.`, column);
    return value;
  }
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseDay(values: RowValues, column: string, required: boolean): string | null {
  const value = required ? values.required(column) : values.get(column);
  if (!value) return null;
  if (!isCalendarDay(value)) throw rowError('INVALID_DATE', `${column} must be a date written YYYY-MM-DD.`, column);
  return value;
}

export function parseBirthDate(values: RowValues, now: Date = new Date()): string {
  const value = values.required('date_of_birth');
  if (!isCalendarDay(value)) throw rowError('INVALID_DATE', 'date_of_birth must be a date written YYYY-MM-DD.', 'date_of_birth');
  if (!isBirthDate(value, now)) {
    throw rowError('INVALID_BIRTH_DATE', 'Enter a real date of birth: not in the future and not more than 120 years ago.', 'date_of_birth');
  }
  return value;
}

/** Decision 315 item 15: Female, Male, or empty. */
export function parseGender(values: RowValues): 'FEMALE' | 'MALE' | null {
  const value = values.get('gender').toLowerCase();
  if (!value) return null;
  if (value === 'female') return 'FEMALE';
  if (value === 'male') return 'MALE';
  throw rowError('INVALID_GENDER', 'gender must be Female or Male, or left empty.', 'gender');
}

export function parseEmail(values: RowValues, column: string, required: boolean): string | null {
  const value = (required ? values.required(column) : values.get(column)).toLowerCase();
  if (!value) return null;
  if (!isEmail(value)) throw rowError('INVALID_EMAIL', `${column} is not an email address.`, column);
  return value;
}

/** An international number (E.164), as the app's sign-up takes it. */
export function parsePhone(values: RowValues): string | null {
  const value = values.get('phone').replace(/[\s().-]/g, '');
  if (!value) return null;
  if (!/^\+\d{6,15}$/.test(value) || !isPhoneNumber(value)) {
    throw rowError('INVALID_PHONE', 'phone must be an international number starting with + and the country code.', 'phone');
  }
  return value;
}

/** HH:MM, 24-hour. */
export function parseTime(values: RowValues, column: string): string {
  const value = values.required(column);
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw rowError('INVALID_TIME', `${column} must be a time written HH:MM (24-hour).`, column);
  }
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function parseCount(values: RowValues, column: string): number | null {
  const value = values.get(column);
  if (!value) return null;
  if (!/^\d{1,4}$/.test(value)) throw rowError('INVALID_NUMBER', `${column} must be a whole number.`, column);
  return Number(value);
}

/** "Brazilian Jiu-Jitsu: Blue; Judo: Yellow" → [{ style, belt }]. One belt
 * per style. */
export function parseBelts(values: RowValues): Array<{ style: string; belt: string }> {
  const value = values.get('belts');
  if (!value) return [];
  const pairs = value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return pairs.map((pair) => {
    const at = pair.lastIndexOf(':');
    const style = at > 0 ? pair.slice(0, at).trim() : '';
    const belt = at > 0 ? pair.slice(at + 1).trim() : '';
    if (!style || !belt) throw rowError('BELTS_FORMAT', 'belts must be written "Style: Belt", separated by ";".', 'belts');
    const key = style.toLowerCase();
    if (seen.has(key)) throw rowError('BELTS_FORMAT', `belts names the style "${style}" twice.`, 'belts');
    seen.add(key);
    return { style, belt };
  });
}

/** Names compared as people type them: case and surrounding spaces ignored. */
export const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
