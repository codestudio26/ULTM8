import { moneyDigits, plainMoney } from '@ultm8/i18n';
import { formatLocale } from '../i18n/format';

/** `MembershipPlan.price` (and everywhere else price appears in this schema) is a
 * minor-unit integer — `apps/api/prisma/schema.prisma:847`, "price Int // minor-unit"
 * — e.g. `2500` means $25.00, not $2500. Found on review, before this ever shipped:
 * MembershipPlanRow originally rendered `plan.price` raw, which would have shown
 * every paid plan's price 100x too large on every Academy a Student browses. */
export function formatMoney(minorUnits: number, currency?: string | null): string {
  const amount = minorUnits / 100;
  const code = (currency ?? 'usd').toUpperCase();
  try {
    // Each currency's own decimals (Decision 431, TXT-6), as the portal shows them.
    return new Intl.NumberFormat(formatLocale(), { style: 'currency', currency: code, ...moneyDigits(code) }).format(amount);
  } catch {
    return `${plainMoney(minorUnits, code)} ${code}`;
  }
}
