import { Transform } from 'class-transformer';

/** Lower-case and trim an email (Decision 295): one person, one account,
 * however they type the capitals. Runs before validation, since the global
 * ValidationPipe has `transform: true`. Every email that becomes or finds a
 * User passes through this. */
export function NormalizeEmail(): PropertyDecorator {
  return Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
}
