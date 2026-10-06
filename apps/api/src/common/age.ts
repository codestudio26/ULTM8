/**
 * Calendar-based age in whole years as of now — not a rolling 365.25-day
 * approximation, so someone who turns N today already counts as N. Extracted from
 * WaiversService.assertSelfAttestedAdult (the original, sole implementation) when
 * MembershipsService.purchase() needed the identical calculation for the same
 * confirmed age-of-majority gate (skills/ultm8-domain-rules/SKILL.md §13, Decision
 * 67: checked at the first consequential action — a Membership purchase, a
 * booking-triggered payment, or waiver-signing, whichever comes first) — kept as
 * one shared function specifically so the two call sites can't silently drift into
 * two different age calculations over time.
 */
export function calculateAge(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() >= dateOfBirth.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}
