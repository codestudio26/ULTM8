/**
 * The sums behind a staff-created charge (Decisions 303, 411). Pure: no
 * database, no dates. Money is in minor units (integers) throughout; rates
 * and percentage discounts are in hundredths of a percent (2000 = 20%).
 *
 * - The discount comes off the price first; tax is worked out on what is
 *   left.
 * - Tax added on top: tax = round(price × rate).
 * - Prices include tax: tax = price − round(price ÷ (1 + rate)).
 * - Rounding is half up, to the minor unit.
 */

export type DiscountType = 'PERCENT' | 'FIXED';

/** The most a charge's price can be, in minor units (999,999.99). */
export const MAX_CHARGE_MINOR = 99_999_999;
/** 100.00%, in hundredths of a percent. */
export const MAX_BASIS_POINTS = 10_000;

export interface ChargeInput {
  /** The price as typed, in minor units (> 0). */
  unitAmount: number;
  discount?: { type: DiscountType; value: number } | null;
  /** 0 to 10000. */
  taxRateBasisPoints: number;
  /** true: the price includes tax. false: tax is added on top. */
  taxInclusive: boolean;
}

export interface ChargeTotals {
  discountAmount: number;
  /** The price excluding tax. */
  netAmount: number;
  taxAmount: number;
  /** The price including tax: what the member owes. */
  grossAmount: number;
}

export class ChargeMathsError extends Error {
  constructor(
    readonly code: 'AMOUNT_INVALID' | 'DISCOUNT_INVALID' | 'DISCOUNT_TOO_BIG' | 'TAX_RATE_INVALID',
    message: string,
  ) {
    super(message);
  }
}

/** numerator ÷ denominator, rounded half up. Both must be non-negative
 * integers small enough that 2 × numerator stays exact (< 2^53). */
export function divideRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

const isWhole = (n: number) => Number.isSafeInteger(n);

/** The discount, the price excluding tax, the tax and the price including tax. */
export function computeCharge(input: ChargeInput): ChargeTotals {
  const { unitAmount, discount, taxRateBasisPoints: rate, taxInclusive } = input;
  if (!isWhole(unitAmount) || unitAmount < 1 || unitAmount > MAX_CHARGE_MINOR) {
    throw new ChargeMathsError('AMOUNT_INVALID', 'The amount must be more than 0 and at most 999,999.99.');
  }
  if (!isWhole(rate) || rate < 0 || rate > MAX_BASIS_POINTS) {
    throw new ChargeMathsError('TAX_RATE_INVALID', 'The tax rate must be between 0% and 100%.');
  }

  let discountAmount = 0;
  if (discount) {
    if (!isWhole(discount.value) || discount.value <= 0) {
      throw new ChargeMathsError('DISCOUNT_INVALID', 'A discount must be more than 0.');
    }
    if (discount.type === 'PERCENT') {
      if (discount.value > MAX_BASIS_POINTS) throw new ChargeMathsError('DISCOUNT_INVALID', 'A percentage discount can be at most 100%.');
      discountAmount = divideRoundHalfUp(unitAmount * discount.value, MAX_BASIS_POINTS);
    } else {
      discountAmount = discount.value;
    }
    if (discountAmount >= unitAmount) {
      throw new ChargeMathsError('DISCOUNT_TOO_BIG', 'The discount must leave something to pay.');
    }
  }

  const price = unitAmount - discountAmount;
  if (taxInclusive) {
    const netAmount = divideRoundHalfUp(price * MAX_BASIS_POINTS, MAX_BASIS_POINTS + rate);
    return { discountAmount, netAmount, taxAmount: price - netAmount, grossAmount: price };
  }
  const taxAmount = divideRoundHalfUp(price * rate, MAX_BASIS_POINTS);
  return { discountAmount, netAmount: price, taxAmount, grossAmount: price + taxAmount };
}

/** An invoice number as shown everywhere: #0000001. */
export function formatInvoiceNumber(n: number): string {
  return `#${String(n).padStart(7, '0')}`;
}
