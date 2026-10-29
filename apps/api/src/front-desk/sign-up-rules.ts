import { Prisma } from '@prisma/client';

/** Decision 362: a rejected sign-up is kept this long, then deleted. */
export const REJECTED_SIGN_UP_DAYS = 30;

/** The School's own "How did you hear about us?" list (Decision 392), or null
 * for the starting list, which the apps show in the viewer's language. */
export function heardFromList(value: Prisma.JsonValue | null): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null;
}
