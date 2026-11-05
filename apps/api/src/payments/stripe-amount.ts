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
import { BadRequestException } from '@nestjs/common';

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
/**
 * Icelandic krona: Stripe takes it as a two-decimal amount (so toStripeAmount
 * leaves it alone) but only accepts whole krónur, amounts divisible by 100
 * (Stripe's "special cases"). HUF and TWD are two-decimal for charges at
 * Stripe (only their payouts must be whole), so they keep step 1.
 */
const WHOLE_UNITS_ONLY = new Set(['ISK']);

/**
 * The currency's real smallest unit, in ULTM8 hundredths (Decision 431, stress
 * test round 5 MON-1..3): 100 for a currency with no decimals (1 yen is 100
 * hundredths), 1 for every other currency (a cent is 1; the three-decimal
 * dinars can't be stored finer than hundredths anyway). Every sum that divides
 * money (a Class Pack's per-class share, tax, a % discount, a % late fee, a
 * card surcharge) rounds once to this step, as SKILL §7 says ("rounded once to
 * the currency's minor unit").
 */
export function minorUnitStep(currency: string | null | undefined): 1 | 100 {
  const code = (currency ?? '').toUpperCase();
  return ZERO_DECIMAL.has(code) || WHOLE_UNITS_ONLY.has(code) ? 100 : 1;
}

/** `x` (any real number of hundredths) rounded half up to a multiple of `step`. */
export function roundToStep(x: number, step: number): number {
  return Math.floor(x / step + 0.5) * step;
}

/** numerator ÷ denominator, rounded half up to a multiple of `step`, in
 * integer arithmetic. Inputs are non-negative integers small enough that
 * 2 × numerator stays exact (< 2^53). */
export function divideRoundHalfUpToStep(numerator: number, denominator: number, step: number): number {
  return Math.floor((2 * numerator + denominator * step) / (2 * denominator * step)) * step;
}

/** Whether `amount` (hundredths) is a whole number of `currency`'s smallest unit. */
export function isWholeMinorUnits(amount: number, currency: string | null | undefined): boolean {
  return Number.isSafeInteger(amount) && amount % minorUnitStep(currency) === 0;
}

/** The 400 every money input answers when it has decimals its currency doesn't have. */
export function amountNotWholeUnit(currency: string | null | undefined) {
  const code = (currency ?? '').toUpperCase();
  return new BadRequestException({
    code: 'AMOUNT_NOT_WHOLE_UNIT',
    message: `${code} amounts can't have decimals. Enter a whole amount.`,
    currency: code,
  });
}

/**
 * Refuses an amount with decimals its currency doesn't have (MON-3): ¥999.50
 * or a ¥0.50 charge. Called wherever an amount typed by a person meets its
 * currency, in the service, so every path (portal, app, API) gets the same 400.
 * A null amount (an optional field left out) passes.
 */
export function assertWholeMinorUnits(amount: number | null | undefined, currency: string | null | undefined): void {
  if (amount === null || amount === undefined) return;
  if (!isWholeMinorUnits(amount, currency)) throw amountNotWholeUnit(currency);
}

/**
 * ULTM8 hundredths to the amount Stripe expects for `currency`. A zero-decimal
 * amount that isn't whole (a fraction kept from before MON-3) is refused
 * rather than rounded: rounding here, per call, is what made a ¥1,000 pack
 * refund ¥999 or ¥1,001 (MON-1).
 */
export function toStripeAmount(hundredths: number, currency: string | null | undefined): number {
  const code = (currency ?? '').toUpperCase();
  if (ZERO_DECIMAL.has(code)) {
    if (hundredths % 100 !== 0) throw amountNotWholeUnit(code);
    return hundredths / 100;
  }
  if (WHOLE_UNITS_ONLY.has(code) && hundredths % 100 !== 0) throw amountNotWholeUnit(code);
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
