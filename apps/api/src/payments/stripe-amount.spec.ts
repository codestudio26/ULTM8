import { fromStripeAmount, toStripeAmount } from './stripe-amount';

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
