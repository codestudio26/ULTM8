/**
 * "The same child" when a parent or the School adds one again: the same first
 * name and surname, compared trimmed, Unicode-normalised (NFC, so "Ọ̀ṣọ́" typed
 * two ways matches) and case-folded, and the same date of birth. Twins have
 * different first names, so they stay two children. Shared by
 * GuardiansService.createMinor (Decision 430 item 4) and the owner's Add a
 * child / child invites (StudentAccessService, Decision 403).
 */
export function foldName(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

export const sameName = (a: string, b: string): boolean => foldName(a) === foldName(b);

/** Same calendar date (YYYY-MM-DD, as stored at UTC midnight). */
export const sameDay = (a: Date | string | null | undefined, b: Date | string): boolean =>
  !!a && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
