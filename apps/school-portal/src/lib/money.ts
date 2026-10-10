/**
 * Minimal minor-unit money display — `${(minorUnits/100).toFixed(2)} CURRENCY`.
 * First money-formatting spot in this codebase's frontend (MembershipPlans and
 * Transactions are the first screens showing real currency amounts); shared
 * here rather than duplicated per-screen so a future improvement (zero-decimal
 * currencies like JPY, thousands separators, locale-aware `Intl.NumberFormat`)
 * only needs to land in one place. Not presented as a finished i18n-aware
 * formatter — a first cut, same as `lib/datetime.ts` was for its own field.
 */
export function formatMoney(minorUnits: number, currency: string | null | undefined): string {
  return `${(minorUnits / 100).toFixed(2)}${currency ? ` ${currency}` : ''}`;
}
