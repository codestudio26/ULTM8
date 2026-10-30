/**
 * Money crosses into Stripe here. ULTM8 keeps every amount in hundredths of
 * the currency, whatever the currency (the portal's MoneyField and
 * formatMoney do the same): 1,000 yen is 100000, and so is 1,000 Kuwaiti
 * dinar. Stripe counts in each currency's own smallest unit instead: yen and
 * won have none (1,000 yen is 1000), and the dinars have three decimals
 * (1,000 KWD is 1000000). Sent unconverted, a yen price was charged 100 times
 * over and a dinar price at a tenth (stress test round 4, M1).
 *
 * The lists are Stripe's own (stripe.com/docs/currencies, "Zero-decimal" and
 * "Three-decimal" currencies).
 */
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** ULTM8 hundredths to the amount Stripe expects for `currency`. */
export function toStripeAmount(hundredths: number, currency: string | null | undefined): number {
  const code = (currency ?? '').toUpperCase();
  if (ZERO_DECIMAL.has(code)) return Math.round(hundredths / 100);
  if (THREE_DECIMAL.has(code)) return hundredths * 10;
  return hundredths;
}

/** An amount Stripe reports (a refund, an invoice, a dispute) back to ULTM8 hundredths. */
export function fromStripeAmount(stripeAmount: number, currency: string | null | undefined): number {
  const code = (currency ?? '').toUpperCase();
  if (ZERO_DECIMAL.has(code)) return stripeAmount * 100;
  if (THREE_DECIMAL.has(code)) return Math.round(stripeAmount / 10);
  return stripeAmount;
}
