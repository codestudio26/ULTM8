/**
 * The sums behind a staff-created charge (Decisions 303, 411). Pure: no
 * database, no dates. Money is in minor units (integers) throughout; rates
 * and percentage discounts are in hundredths of a percent (2000 = 20%).
 *
 * - The discount comes off the price first; tax is worked out on what is
 *   left.
 * - Tax added on top: tax = round(price × rate).
 * - Prices include tax: tax = price − round(price ÷ (1 + rate)).
 * - Rounding is half up, to the currency's real minor unit (Decision 430,
 *   MON-2): whole yen for a zero-decimal currency (minorUnitStep()), so a
 *   member who pays every yen owes nothing; the cent everywhere else.
 * - "No tax on this item" (Decision 414 item 5): a rate of 0, so the price
 *   excluding tax and the price including tax are both the price after the
 *   discount, whichever way the School prices (taxForCharge()).
 */

import { divideRoundHalfUpToStep, minorUnitStep } from '../payments/stripe-amount';
import type { TaxLineAmount, TaxLineSetting } from './tax-lines';

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
  /** The charge's currency: sets the step every sum rounds to (MON-2). */
  currency: string | null | undefined;
  /**
   * Decision 430 (MON-6): the named tax lines, when the School (or the
   * member's Branch) has them. Their combined rate is the charge's rate, and
   * the result carries each line's amount. Left out: one unnamed rate.
   */
  taxLines?: TaxLineSetting[];
}

export interface ChargeTotals {
  discountAmount: number;
  /** The price excluding tax. */
  netAmount: number;
  taxAmount: number;
  /** The price including tax: what the member owes. */
  grossAmount: number;
  /** Each tax line's amount, adding up to taxAmount; only when the input had taxLines. */
  taxLines?: TaxLineAmount[];
}

export class ChargeMathsError extends Error {
  constructor(
    readonly code: 'AMOUNT_INVALID' | 'DISCOUNT_INVALID' | 'DISCOUNT_TOO_BIG' | 'TAX_RATE_INVALID',
    message: string,
  ) {
    super(message);
  }
}

/**
 * The tax a charge is worked out and kept with: the School's settings
 * (Decision 411), or a rate of 0 when staff ticked "No tax on this item (0% or
 * exempt)" (Decision 414 item 5). The School's inclusive/added-on-top setting
 * is kept either way; at 0% it changes nothing.
 */
export function taxForCharge(
  school: { taxRateBasisPoints: number; taxInclusive: boolean },
  taxExempt: boolean,
): { taxRateBasisPoints: number; taxInclusive: boolean } {
  return { taxRateBasisPoints: taxExempt ? 0 : school.taxRateBasisPoints, taxInclusive: school.taxInclusive };
}

/**
 * taxForCharge() for the tax that applies to one member (Decision 430,
 * MON-6): the School's lines, or their home Branch's when it overrides
 * (loadEffectiveTax()). The combined rate is the charge's rate and the lines
 * go to computeCharge(). "No tax on this item": rate 0 and no lines.
 */
export function taxLinesForCharge(
  tax: { taxInclusive: boolean; lines: TaxLineSetting[] },
  taxExempt: boolean,
): { taxRateBasisPoints: number; taxInclusive: boolean; taxLines?: TaxLineSetting[] } {
  if (taxExempt || tax.lines.length === 0) return { taxRateBasisPoints: 0, taxInclusive: tax.taxInclusive };
  return { taxRateBasisPoints: tax.lines.reduce((sum, l) => sum + l.rateBasisPoints, 0), taxInclusive: tax.taxInclusive, taxLines: tax.lines };
}

/** numerator ÷ denominator, rounded half up. Both must be non-negative
 * integers small enough that 2 × numerator stays exact (< 2^53). */
export function divideRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

const isWhole = (n: number) => Number.isSafeInteger(n);

/** The discount, the price excluding tax, the tax and the price including tax. */
export function computeCharge(input: ChargeInput): ChargeTotals {
  const { unitAmount, discount, taxInclusive, taxLines } = input;
  const rate = taxLines ? taxLines.reduce((sum, l) => sum + l.rateBasisPoints, 0) : input.taxRateBasisPoints;
  const step = minorUnitStep(input.currency);
  if (!isWhole(unitAmount) || unitAmount < 1 || unitAmount > MAX_CHARGE_MINOR) {
    throw new ChargeMathsError('AMOUNT_INVALID', 'The amount must be more than 0 and at most 999,999.99.');
  }
  if (!isWhole(rate) || rate < 0 || rate > MAX_BASIS_POINTS || (taxLines ?? []).some((l) => !isWhole(l.rateBasisPoints) || l.rateBasisPoints < 0)) {
    throw new ChargeMathsError('TAX_RATE_INVALID', 'The tax rate must be between 0% and 100%.');
  }

  let discountAmount = 0;
  if (discount) {
    if (!isWhole(discount.value) || discount.value <= 0) {
      throw new ChargeMathsError('DISCOUNT_INVALID', 'A discount must be more than 0.');
    }
    if (discount.type === 'PERCENT') {
      if (discount.value > MAX_BASIS_POINTS) throw new ChargeMathsError('DISCOUNT_INVALID', 'A percentage discount can be at most 100%.');
      discountAmount = divideRoundHalfUpToStep(unitAmount * discount.value, MAX_BASIS_POINTS, step);
    } else {
      discountAmount = discount.value;
    }
    if (discountAmount >= unitAmount) {
      throw new ChargeMathsError('DISCOUNT_TOO_BIG', 'The discount must leave something to pay.');
    }
  }

  const price = unitAmount - discountAmount;
  if (taxInclusive) {
    const netAmount = divideRoundHalfUpToStep(price * MAX_BASIS_POINTS, MAX_BASIS_POINTS + rate, step);
    const taxAmount = price - netAmount;
    // Each line is its rate of the price excluding tax; the last takes what
    // rounding leaves, so the lines add up to the tax exactly.
    const lines = taxLines ? splitLines(taxLines, taxAmount, (r) => divideRoundHalfUpToStep(netAmount * r, MAX_BASIS_POINTS, step)) : undefined;
    return { discountAmount, netAmount, taxAmount, grossAmount: price, ...(lines ? { taxLines: lines } : {}) };
  }
  if (taxLines) {
    // Tax added on top: each line is worked out on the price and rounded on
    // its own (GST and PST are two taxes), and the tax is their sum.
    const lines = taxLines.map((l) => ({ ...l, amount: divideRoundHalfUpToStep(price * l.rateBasisPoints, MAX_BASIS_POINTS, step) }));
    const taxAmount = lines.reduce((sum, l) => sum + l.amount, 0);
    return { discountAmount, netAmount: price, taxAmount, grossAmount: price + taxAmount, taxLines: lines };
  }
  const taxAmount = divideRoundHalfUpToStep(price * rate, MAX_BASIS_POINTS, step);
  return { discountAmount, netAmount: price, taxAmount, grossAmount: price + taxAmount };
}

/** `total` shared over the lines: each line its own share, the last what is left. */
function splitLines(lines: TaxLineSetting[], total: number, share: (rate: number) => number): TaxLineAmount[] {
  let given = 0;
  return lines.map((l, i) => {
    const amount = i === lines.length - 1 ? total - given : Math.min(share(l.rateBasisPoints), total - given);
    given += amount;
    return { ...l, amount };
  });
}

/** An invoice number as shown everywhere: #0000001. */
export function formatInvoiceNumber(n: number): string {
  return `#${String(n).padStart(7, '0')}`;
}
