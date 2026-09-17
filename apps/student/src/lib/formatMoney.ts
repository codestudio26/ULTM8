/** `MembershipPlan.price` (and everywhere else price appears in this schema) is a
 * minor-unit integer — `apps/api/prisma/schema.prisma:847`, "price Int // minor-unit"
 * — e.g. `2500` means $25.00, not $2500. Found on review, before this ever shipped:
 * MembershipPlanRow originally rendered `plan.price` raw, which would have shown
 * every paid plan's price 100x too large on every Academy a Student browses. */
export function formatMoney(minorUnits: number, currency?: string | null): string {
  const amount = minorUnits / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency ?? 'usd').toUpperCase() }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${(currency ?? 'usd').toUpperCase()}`;
  }
}
