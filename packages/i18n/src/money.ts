/**
 * Decimals per currency, shared by the School Portal, the student app and the
 * API's translated notices (Decision 430: stress test round 5 MON-3, MON-10,
 * TXT-6). Amounts are stored in hundredths for every currency; this says how
 * many of those decimals are real.
 *
 * The lists follow Stripe's (stripe.com/docs/currencies): the zero-decimal
 * currencies, plus the Icelandic krona, which Stripe takes only in whole
 * krónur; and the three-decimal dinars. The API's own copy is
 * apps/api/src/payments/stripe-amount.ts (minorUnitStep), and its unit test
 * checks the two agree. Stripe, not Intl, decides here: Intl says the forint
 * has 0 decimals, but Stripe charges it with 2.
 */
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** The currency's own decimals: 0 for yen, 3 for Kuwaiti dinar, else 2. */
export function currencyFractionDigits(currency: string | null | undefined): number {
  const code = (currency ?? '').toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/**
 * The decimals to show for an amount kept in hundredths (TXT-6): at least the
 * currency's own, at most max(own, 2). So ¥12,345 (not ¥12,345.00), US$12.50,
 * KWD 25.000; and a fraction of a yen kept from before Decision 430 still
 * shows honestly as ¥1,332.72, never rounded away. Pass these to
 * Intl.NumberFormat's minimumFractionDigits / maximumFractionDigits.
 */
export function moneyDigits(currency: string | null | undefined): { minimumFractionDigits: number; maximumFractionDigits: number } {
  const own = currencyFractionDigits(currency);
  return { minimumFractionDigits: own, maximumFractionDigits: Math.max(own, 2) };
}

/** The decimals a person can type for an amount in this currency (the
 * portal's MoneyField): the currency's own, but never more than the two that
 * can be stored (a Kuwaiti dinar can't be typed down to the fils). */
export function typeableFractionDigits(currency: string | null | undefined): number {
  return Math.min(2, currencyFractionDigits(currency));
}

/**
 * An amount in hundredths as a plain number for a spreadsheet (no symbol, no
 * grouping, "." decimal): "12345" for yen, "12.50" for dollars, "25.000" for
 * Kuwaiti dinar, and a stored fraction of a yen still as "1332.72".
 */
export function plainMoney(minorUnits: number, currency: string | null | undefined): string {
  const { minimumFractionDigits, maximumFractionDigits } = moneyDigits(currency);
  return (minorUnits / 100).toFixed(minimumFractionDigits === 0 && minorUnits % 100 === 0 ? 0 : maximumFractionDigits);
}
