import { STANDARD_TAX_RATES, standardTaxRateFor } from './standard-tax-rates';

describe('ULTM8 standard tax rates (Decision 411)', () => {
  it('lists each country once, with a valid code and rate', () => {
    const codes = STANDARD_TAX_RATES.map((r) => r.country);
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of STANDARD_TAX_RATES) {
      expect(r.country).toMatch(/^[A-Z]{2}$/);
      expect(Number.isInteger(r.rateBasisPoints)).toBe(true);
      expect(r.rateBasisPoints).toBeGreaterThanOrEqual(0);
      expect(r.rateBasisPoints).toBeLessThanOrEqual(10000);
      if (!r.national) expect(r.rateBasisPoints).toBe(0);
    }
  });

  it('finds a country in any case, and pre-fills nothing for the US', () => {
    expect(standardTaxRateFor('gb')).toEqual({ country: 'GB', rateBasisPoints: 2000, national: true });
    expect(standardTaxRateFor('US')).toEqual({ country: 'US', rateBasisPoints: 0, national: false });
    expect(standardTaxRateFor('ZZ')).toBeNull();
    expect(standardTaxRateFor(null)).toBeNull();
  });
});
