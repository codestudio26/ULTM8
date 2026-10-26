import { registerDecorator, ValidationOptions } from 'class-validator';

/** The oldest date of birth accepted, in years before today (Decision 324). */
export const MAX_AGE_YEARS = 120;

export const BIRTH_DATE_MESSAGE = 'Enter a real date of birth: not in the future and not more than 120 years ago.';

/** True when `value` starts with a real calendar date (YYYY-MM-DD) that is
 * not after today and not more than MAX_AGE_YEARS before it, both in UTC.
 * `@IsDateString` alone accepts 2021-02-30, which Postgres then saves as
 * 2 March, and any future date (Decision 324, S5). */
export function isBirthDate(value: unknown, today: Date = new Date()): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const oldest = Date.UTC(today.getUTCFullYear() - MAX_AGE_YEARS, today.getUTCMonth(), today.getUTCDate());
  return date.getTime() <= todayUtc && date.getTime() >= oldest;
}

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

/** True when someone born on `dateOfBirth` is 18 or over on `today` (UTC
 * calendar dates; a birthday today counts). An unknown date of birth counts
 * as under 18, as the waiver adult check does. */
export function isAdultOn(dateOfBirth: Date | null | undefined, today: Date = new Date()): boolean {
  if (!dateOfBirth) return false;
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const hadBirthday =
    today.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() && today.getUTCDate() >= dateOfBirth.getUTCDate());
  if (!hadBirthday) age -= 1;
  return age >= AGE_OF_MAJORITY_YEARS;
}
