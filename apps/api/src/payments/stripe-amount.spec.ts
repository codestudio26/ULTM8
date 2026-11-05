import { currencyFractionDigits } from '@ultm8/i18n';
import { assertWholeMinorUnits, divideRoundHalfUpToStep, fromStripeAmount, isWholeMinorUnits, minorUnitStep, roundToStep, toStripeAmount } from './stripe-amount';

describe('stripe-amount (stress test round 4, M1)', () => {
  it('sends two-decimal currencies unchanged', () => {
    expect(toStripeAmount(100000, 'USD')).toBe(100000);
    expect(toStripeAmount(4990, 'brl')).toBe(4990);
    expect(toStripeAmount(1999, 'GBP')).toBe(1999);
  });

  it('sends whole yen, won and pesos for zero-decimal currencies', () => {
    // 1,000 yen is stored as 100000 hundredths; Stripe wants 1000.
    expect(toStripeAmount(100000, 'JPY')).toBe(1000);
    expect(toStripeAmount(5500000, 'krw')).toBe(55000);
    expect(toStripeAmount(1999000, 'CLP')).toBe(19990);
  });

  it('sends thousandths for three-decimal currencies', () => {
    // 25.00 KWD is stored as 2500 hundredths; Stripe wants 25000 fils.
    expect(toStripeAmount(2500, 'KWD')).toBe(25000);
    expect(toStripeAmount(1050, 'bhd')).toBe(10500);
  });

  it('reads Stripe amounts back to hundredths', () => {
    expect(fromStripeAmount(1000, 'jpy')).toBe(100000);
    expect(fromStripeAmount(25000, 'kwd')).toBe(2500);
    expect(fromStripeAmount(4990, 'brl')).toBe(4990);
    for (const [amount, cur] of [[123456, 'JPY'], [987650, 'KWD'], [1234, 'EUR']] as const) {
      expect(fromStripeAmount(toStripeAmount(amount * 100, cur), cur)).toBe(amount * 100);
    }
  });

  it('treats a missing currency as two decimals', () => {
    expect(toStripeAmount(500, null)).toBe(500);
    expect(fromStripeAmount(500, undefined)).toBe(500);
  });
});

describe('the currency\'s real minor unit (Decision 431, stress test round 5 MON-1..3)', () => {
  it('is whole yen, won and krónur for zero-decimal currencies, the cent elsewhere', () => {
    expect(minorUnitStep('JPY')).toBe(100);
    expect(minorUnitStep('krw')).toBe(100);
    expect(minorUnitStep('ISK')).toBe(100);
    expect(minorUnitStep('HUF')).toBe(1);
    expect(minorUnitStep('TWD')).toBe(1);
    expect(minorUnitStep('USD')).toBe(1);
    expect(minorUnitStep('KWD')).toBe(1);
    expect(minorUnitStep(null)).toBe(1);
  });

  it('matches the decimals the apps let people type (@ultm8/i18n currencyFractionDigits)', () => {
    for (const code of ['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF', 'ISK', 'HUF', 'TWD', 'USD', 'EUR', 'BRL', 'KWD', 'BHD']) {
      expect(minorUnitStep(code)).toBe(10 ** (2 - Math.min(2, currencyFractionDigits(code))));
    }
  });

  it('rounds half up to the step', () => {
    expect(roundToStep(33333.33, 100)).toBe(33300);
    expect(roundToStep(66666.67, 100)).toBe(66700);
    expect(roundToStep(14285.71, 100)).toBe(14300);
    expect(roundToStep(14250, 100)).toBe(14300);
    expect(roundToStep(14249.9, 100)).toBe(14200);
    expect(roundToStep(1234.5, 1)).toBe(1235);
    expect(divideRoundHalfUpToStep(123400 * 800, 10000, 100)).toBe(9900); // ¥1,234 × 8% = ¥98.72 → ¥99
    expect(divideRoundHalfUpToStep(123400 * 800, 10000, 1)).toBe(9872);
    expect(divideRoundHalfUpToStep(5, 2, 1)).toBe(3);
  });

  it('knows whole and fractional amounts', () => {
    expect(isWholeMinorUnits(100000, 'JPY')).toBe(true);
    expect(isWholeMinorUnits(99950, 'JPY')).toBe(false);
    expect(isWholeMinorUnits(99950, 'USD')).toBe(true);
    expect(() => assertWholeMinorUnits(50, 'JPY')).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'AMOUNT_NOT_WHOLE_UNIT' }) }));
    expect(() => assertWholeMinorUnits(null, 'JPY')).not.toThrow();
    expect(() => assertWholeMinorUnits(5000, 'JPY')).not.toThrow();
  });

  it('refuses to send Stripe a fraction of a yen instead of rounding it', () => {
    expect(() => toStripeAmount(33333, 'JPY')).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'AMOUNT_NOT_WHOLE_UNIT' }) }));
    expect(() => toStripeAmount(49, 'JPY')).toThrow();
    expect(() => toStripeAmount(150, 'ISK')).toThrow();
    expect(toStripeAmount(15000, 'ISK')).toBe(15000);
    expect(toStripeAmount(33300, 'JPY')).toBe(333);
  });
});
