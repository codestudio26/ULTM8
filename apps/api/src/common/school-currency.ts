import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Decision 414 item 6 — currency first. Until the School has set its currency
 * on the School page, no price can be saved anywhere: membership plans, belt
 * prices for promotion fees, charges, and the School's other fees. A price of
 * 0 (a free plan, a free belt) needs no currency and is always allowed.
 *
 * Only a price being set is refused. Records saved before this rule keep
 * their amounts and can still be edited (a title, a schedule): each caller
 * asks for the currency only when the request sets a new non-zero amount.
 */
export const SCHOOL_CURRENCY_REQUIRED = 'SCHOOL_CURRENCY_REQUIRED';

export const SCHOOL_CURRENCY_REQUIRED_MESSAGE = "Set your School's currency on the School page before setting prices.";

export function schoolCurrencyRequired(): BadRequestException {
  return new BadRequestException({ code: SCHOOL_CURRENCY_REQUIRED, message: SCHOOL_CURRENCY_REQUIRED_MESSAGE });
}

/** True when `next` would save a new non-zero amount over `current` (undefined = not sent). */
export function setsNewPrice(next: number | null | undefined, current?: number | null): boolean {
  return typeof next === 'number' && next > 0 && next !== (current ?? null);
}

/** The School's currency, upper-cased; refuses with SCHOOL_CURRENCY_REQUIRED when it isn't set. */
export function requireSchoolCurrency(currency: string | null | undefined): string {
  const code = currency?.trim().toUpperCase();
  if (!code) throw schoolCurrencyRequired();
  return code;
}

/** Reads the School's currency (on a connection the caller is already allowed
 * to use for this School) and refuses when it isn't set. */
export async function assertSchoolCurrencySet(db: Pick<Prisma.TransactionClient, 'school'>, schoolId: string): Promise<string> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { defaultCurrency: true } });
  return requireSchoolCurrency(school?.defaultCurrency);
}
