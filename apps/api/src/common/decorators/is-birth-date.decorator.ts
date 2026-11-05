import { DateTime } from 'luxon';
import { registerDecorator, ValidationOptions } from 'class-validator';

/** The oldest date of birth accepted, in years before today (Decision 341). */
export const MAX_AGE_YEARS = 120;

export const BIRTH_DATE_MESSAGE = 'Enter a real date of birth: not in the future and not more than 120 years ago.';

/** True when `value` starts with a real calendar date (YYYY-MM-DD) that is
 * not after today and not more than MAX_AGE_YEARS before it. "Today" is the
 * latest calendar date anywhere on Earth (UTC+14), so a baby born today in
 * Kolkata or Kiritimati is never "in the future" (Decision 430 item 10,
 * IN-4). `@IsDateString` alone accepts 2021-02-30, which Postgres then saves
 * as 2 March, and any future date (Decision 341, S5). */
export function isBirthDate(value: unknown, today: Date = new Date()): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  const latest = new Date(today.getTime() + LATEST_UTC_OFFSET_MS);
  const todayLatest = Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate());
  const oldest = Date.UTC(today.getUTCFullYear() - MAX_AGE_YEARS, today.getUTCMonth(), today.getUTCDate());
  return date.getTime() <= todayLatest && date.getTime() >= oldest;
}

/** UTC+14 (Line Islands), the earliest place on Earth to reach a new day. */
const LATEST_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;

/** Validates a date of birth with isBirthDate. Use after `@IsDateString()`. */
export function IsBirthDate(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isBirthDate',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: BIRTH_DATE_MESSAGE, ...options },
      validator: { validate: (value: unknown) => isBirthDate(value) },
    });
  };
}

/** Age of majority (Decision 67: a Guardian consents for anyone younger). */
export const AGE_OF_MAJORITY_YEARS = 18;

/** The calendar date (YYYY-MM-DD) it is at `now` in `zone` (an IANA zone; a
 * missing or unknown zone counts as UTC). */
export function localDateIn(now: Date, zone?: string | null): string {
  const dt = zone ? DateTime.fromJSDate(now, { zone }) : DateTime.invalid('no zone');
  return (dt.isValid ? dt : DateTime.fromJSDate(now, { zone: 'UTC' })).toISODate() as string;
}

/** Whole years someone born on `dateOfBirth` (a calendar date stored at UTC
 * midnight) is on `now`, counted on the calendar date in `zone` (Decision 430
 * item 10, FAM-10: the School's or Branch's own date, not the UTC one, so a
 * Sydney teen is 18 from midnight in Sydney). A 29 February birthday counts
 * from 1 March in a common year. */
export function ageOn(dateOfBirth: Date, now: Date = new Date(), zone?: string | null): number {
  const [y, m, d] = localDateIn(now, zone).split('-').map(Number);
  let age = y - dateOfBirth.getUTCFullYear();
  const hadBirthday = m > dateOfBirth.getUTCMonth() + 1 || (m === dateOfBirth.getUTCMonth() + 1 && d >= dateOfBirth.getUTCDate());
  if (!hadBirthday) age -= 1;
  return age;
}

/** True when someone born on `dateOfBirth` is 18 or over on `now`, on the
 * calendar date in `zone` (the School's, or the Branch's when it has its own;
 * UTC when there is no School, as at register). A birthday today counts. An
 * unknown date of birth counts as under 18, as the waiver adult check does. */
export function isAdultOn(dateOfBirth: Date | null | undefined, now: Date = new Date(), zone?: string | null): boolean {
  if (!dateOfBirth) return false;
  return ageOn(dateOfBirth, now, zone) >= AGE_OF_MAJORITY_YEARS;
}

/** The day someone turns 18 (YYYY-MM-DD); a 29 February birthday turns 18 on
 * 1 March in a common year. */
export function eighteenthBirthday(dateOfBirth: Date): string {
  const y = dateOfBirth.getUTCFullYear() + AGE_OF_MAJORITY_YEARS;
  const d = new Date(Date.UTC(y, dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate()));
  return d.toISOString().slice(0, 10);
}
