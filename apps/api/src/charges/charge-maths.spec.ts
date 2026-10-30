import { ChargeMathsError, computeCharge, divideRoundHalfUp, formatInvoiceNumber, taxForCharge } from './charge-maths';

describe('charge maths (Decisions 303, 411)', () => {
  it('rounds half up', () => {
    expect(divideRoundHalfUp(5, 2)).toBe(3);
    expect(divideRoundHalfUp(4, 2)).toBe(2);
    expect(divideRoundHalfUp(149, 100)).toBe(1);
    expect(divideRoundHalfUp(150, 100)).toBe(2);
    expect(divideRoundHalfUp(0, 7)).toBe(0);
  });

  it('adds tax on top of the price', () => {
    expect(computeCharge({ unitAmount: 10000, taxRateBasisPoints: 2000, taxInclusive: false })).toEqual({
      discountAmount: 0,
      netAmount: 10000,
      taxAmount: 2000,
      grossAmount: 12000,
    });
  });

  it('takes tax out of a price that includes it', () => {
    // 120.00 at 20%: 100.00 + 20.00.
    expect(computeCharge({ unitAmount: 12000, taxRateBasisPoints: 2000, taxInclusive: true })).toEqual({
      discountAmount: 0,
      netAmount: 10000,
      taxAmount: 2000,
      grossAmount: 12000,
    });
    // 10.00 at 23%: 10.00 / 1.23 = 8.1300… → 8.13, tax 1.87.
    expect(computeCharge({ unitAmount: 1000, taxRateBasisPoints: 2300, taxInclusive: true })).toEqual({
      discountAmount: 0,
      netAmount: 813,
      taxAmount: 187,
      grossAmount: 1000,
    });
  });

  it('rounds the tax half up to the minor unit', () => {
    // 0.25 × 10% = 0.025 → 0.03.
    expect(computeCharge({ unitAmount: 25, taxRateBasisPoints: 1000, taxInclusive: false }).taxAmount).toBe(3);
    // 0.24 × 10% = 0.024 → 0.02.
    expect(computeCharge({ unitAmount: 24, taxRateBasisPoints: 1000, taxInclusive: false }).taxAmount).toBe(2);
    // A rate with two decimals: 99.99 × 8.1% = 8.09919 → 8.10.
    expect(computeCharge({ unitAmount: 9999, taxRateBasisPoints: 810, taxInclusive: false }).taxAmount).toBe(810);
  });

  it('works out tax on the discounted price, for a % discount', () => {
    // 120.00 less 12.5% (15.00) = 105.00, then 20% on top = 21.00.
    expect(computeCharge({ unitAmount: 12000, discount: { type: 'PERCENT', value: 1250 }, taxRateBasisPoints: 2000, taxInclusive: false })).toEqual({
      discountAmount: 1500,
      netAmount: 10500,
      taxAmount: 2100,
      grossAmount: 12600,
    });
    // 33.33% of 10.00 = 3.333 → 3.33.
    expect(computeCharge({ unitAmount: 1000, discount: { type: 'PERCENT', value: 3333 }, taxRateBasisPoints: 0, taxInclusive: true }).discountAmount).toBe(333);
  });

  it('works out tax on the discounted price, for a fixed discount', () => {
    // 120.00 less 20.00 = 100.00, which includes 20% tax: 83.33 + 16.67.
    expect(computeCharge({ unitAmount: 12000, discount: { type: 'FIXED', value: 2000 }, taxRateBasisPoints: 2000, taxInclusive: true })).toEqual({
      discountAmount: 2000,
      netAmount: 8333,
      taxAmount: 1667,
      grossAmount: 10000,
    });
  });

  it('charges no tax at a 0% rate', () => {
    expect(computeCharge({ unitAmount: 999, taxRateBasisPoints: 0, taxInclusive: true })).toEqual({ discountAmount: 0, netAmount: 999, taxAmount: 0, grossAmount: 999 });
    expect(computeCharge({ unitAmount: 999, taxRateBasisPoints: 0, taxInclusive: false })).toEqual({ discountAmount: 0, netAmount: 999, taxAmount: 0, grossAmount: 999 });
  });

  it('always has net + tax = gross', () => {
    for (let unit = 1; unit < 3000; unit += 7) {
      for (const rate of [0, 1, 500, 810, 1750, 2100, 2550, 10000]) {
        for (const inclusive of [true, false]) {
          const r = computeCharge({ unitAmount: unit, taxRateBasisPoints: rate, taxInclusive: inclusive });
          expect(r.netAmount + r.taxAmount).toBe(r.grossAmount);
          expect(r.taxAmount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('refuses bad input', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return (err as ChargeMathsError).code;
      }
      return null;
    };
    expect(code(() => computeCharge({ unitAmount: 0, taxRateBasisPoints: 0, taxInclusive: true }))).toBe('AMOUNT_INVALID');
    expect(code(() => computeCharge({ unitAmount: 1.5, taxRateBasisPoints: 0, taxInclusive: true }))).toBe('AMOUNT_INVALID');
    expect(code(() => computeCharge({ unitAmount: 100_000_000, taxRateBasisPoints: 0, taxInclusive: true }))).toBe('AMOUNT_INVALID');
    expect(code(() => computeCharge({ unitAmount: 100, taxRateBasisPoints: 10001, taxInclusive: true }))).toBe('TAX_RATE_INVALID');
    expect(code(() => computeCharge({ unitAmount: 100, taxRateBasisPoints: -1, taxInclusive: true }))).toBe('TAX_RATE_INVALID');
    expect(code(() => computeCharge({ unitAmount: 100, discount: { type: 'PERCENT', value: 0 }, taxRateBasisPoints: 0, taxInclusive: true }))).toBe('DISCOUNT_INVALID');
    expect(code(() => computeCharge({ unitAmount: 100, discount: { type: 'PERCENT', value: 10001 }, taxRateBasisPoints: 0, taxInclusive: true }))).toBe('DISCOUNT_INVALID');
    expect(code(() => computeCharge({ unitAmount: 100, discount: { type: 'PERCENT', value: 10000 }, taxRateBasisPoints: 0, taxInclusive: true }))).toBe('DISCOUNT_TOO_BIG');
    expect(code(() => computeCharge({ unitAmount: 100, discount: { type: 'FIXED', value: 100 }, taxRateBasisPoints: 0, taxInclusive: true }))).toBe('DISCOUNT_TOO_BIG');
  });

  it('"No tax on this item" (Decision 414 item 5): no tax, net = gross = the price, either way the School prices', () => {
    const onTop = { taxRateBasisPoints: 2000, taxInclusive: false };
    const inclusive = { taxRateBasisPoints: 2000, taxInclusive: true };
    expect(taxForCharge(onTop, true)).toEqual({ taxRateBasisPoints: 0, taxInclusive: false });
    expect(taxForCharge(inclusive, true)).toEqual({ taxRateBasisPoints: 0, taxInclusive: true });
    expect(taxForCharge(onTop, false)).toEqual(onTop);
    for (const school of [onTop, inclusive]) {
      expect(computeCharge({ unitAmount: 2500, ...taxForCharge(school, true) })).toEqual({ discountAmount: 0, netAmount: 2500, taxAmount: 0, grossAmount: 2500 });
      expect(computeCharge({ unitAmount: 2500, discount: { type: 'PERCENT', value: 1000 }, ...taxForCharge(school, true) })).toEqual({ discountAmount: 250, netAmount: 2250, taxAmount: 0, grossAmount: 2250 });
    }
  });

  it('shows invoice numbers with seven digits', () => {
    expect(formatInvoiceNumber(1)).toBe('#0000001');
    expect(formatInvoiceNumber(1234567)).toBe('#1234567');
  });
});
