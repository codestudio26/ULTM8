/** Age of majority, confirmed final across every market (Decision 77). */
export const AGE_OF_MAJORITY = 18;

/**
 * Whole years between `dateOfBirth` and `today`, by the calendar: someone born on
 * this day 18 years ago is 18 today. Not a 365.25-day approximation. Moved here
 * from WaiversService.assertSelfAttestedAdult() so the Guardian age checks
 * (Decision 172) compute age exactly the same way.
 */
export function calendarAge(dateOfBirth: Date, today: Date = new Date()): number {
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const hasHadBirthdayThisYear =
    today.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() && today.getUTCDate() >= dateOfBirth.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}
