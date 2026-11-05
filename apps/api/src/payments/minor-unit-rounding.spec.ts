import { computeCharge } from '../charges/charge-maths';
import { lateFeeAmount } from '../late-fees/late-fee-maths';
import { cardSurchargeAmount, planCardSurcharge } from './card-surcharge';
import { classShare } from '../bookings/cancellation.service';
import { toStripeAmount } from './stripe-amount';

/**
 * Decision 430 (stress test round 5, MON-1 and MON-2): every sum that divides
 * money rounds once to the currency's real smallest unit. In yen that is
 * whole yen (100 hundredths), so the ledger and Stripe always agree.
 */
describe('rounding to the currency\'s minor unit (MON-1, MON-2)', () => {
  describe('Class Pack per-class refund shares (MON-1)', () => {
    const shares = (paid: number, n: number, currency: string, step = currency === 'JPY' || currency === 'KRW' ? 100 : 1) => {
      const out: number[] = [];
      for (let prior = 0; prior < n; prior++) out.push(classShare(paid, out.reduce((a, b) => a + b, 0), n, prior, step));
      return out;
    };

    it('¥1,000 in 3 classes: whole yen, adding up to exactly ¥1,000', () => {
      const s = shares(100000, 3, 'JPY');
      expect(s).toEqual([33300, 33400, 33300]);
      expect(s.reduce((a, b) => a + b, 0)).toBe(100000);
      expect(s.map((x) => toStripeAmount(x, 'JPY')).reduce((a, b) => a + b, 0)).toBe(1000);
    });

    it('¥1,000 in 7 classes: never asks Stripe for more than was paid', () => {
      const s = shares(100000, 7, 'JPY');
      expect(s.every((x) => x % 100 === 0)).toBe(true);
      expect(s.reduce((a, b) => a + b, 0)).toBe(100000);
      expect(s.map((x) => toStripeAmount(x, 'JPY')).reduce((a, b) => a + b, 0)).toBe(1000);
    });

    it('won works the same way', () => {
      const s = shares(1000000, 3, 'KRW');
      expect(s.every((x) => x % 100 === 0)).toBe(true);
      expect(s.reduce((a, b) => a + b, 0)).toBe(1000000);
    });

    it('two-decimal currencies keep cent shares, as before', () => {
      expect(shares(10000, 3, 'USD')).toEqual([3333, 3334, 3333]);
    });

    it('never more than is left, rounded down to whole yen', () => {
      // A legacy ¥999.50 pack (from before MON-3): the last share stops at whole yen.
      const s = shares(99950, 2, 'JPY');
      expect(s.every((x) => x % 100 === 0)).toBe(true);
      expect(s.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(99950);
      expect(classShare(100000, 100000, 3, 2, 100)).toBe(0);
    });
  });

  describe('charges, tax and discounts (MON-2)', () => {
    it('¥1,234 + 8% on top: tax ¥99, total ¥1,333 (not ¥1,332.72)', () => {
      expect(computeCharge({ unitAmount: 123400, taxRateBasisPoints: 800, taxInclusive: false, currency: 'JPY' })).toEqual({
        discountAmount: 0,
        netAmount: 123400,
        taxAmount: 9900,
        grossAmount: 133300,
      });
    });

    it('¥1,234 including 10%: tax ¥112', () => {
      const t = computeCharge({ unitAmount: 123400, taxRateBasisPoints: 1000, taxInclusive: true, currency: 'JPY' });
      expect(t.taxAmount).toBe(11200);
      expect(t.grossAmount).toBe(123400);
      expect(t.netAmount + t.taxAmount).toBe(123400);
    });

    it('33.33% off ¥1,000: ¥333 off, everything in whole yen', () => {
      const t = computeCharge({ unitAmount: 100000, discount: { type: 'PERCENT', value: 3333 }, taxRateBasisPoints: 1000, taxInclusive: true, currency: 'JPY' });
      expect(t.discountAmount).toBe(33300);
      for (const v of Object.values(t)) expect(v % 100).toBe(0);
    });

    it('the same sums in pounds keep pence', () => {
      expect(computeCharge({ unitAmount: 123400, taxRateBasisPoints: 800, taxInclusive: false, currency: 'GBP' }).taxAmount).toBe(9872);
    });

    it('a % late fee in yen is whole yen', () => {
      expect(lateFeeAmount({ type: 'PERCENT', percentBps: 333 }, 7200, 'JPY')).toBe(200); // 3.33% of ¥72 = ¥2.40 → ¥2
      expect(lateFeeAmount({ type: 'PERCENT', percentBps: 333 }, 72, 'JPY')).toBe(0); // the round-4 ¥0.72 leftover: no ¥0.02 fee
      expect(lateFeeAmount({ type: 'PERCENT', percentBps: 250 }, 1000000, 'JPY')).toBe(25000);
      expect(lateFeeAmount({ type: 'PERCENT', percentBps: 333 }, 133300, 'JPY') % 100).toBe(0);
    });

    it('a card surcharge in yen is whole yen', () => {
      expect(cardSurchargeAmount(123400, 250, 'JPY')).toBe(3100); // 2.5% of ¥1,234 = ¥30.85 → ¥31
      expect(cardSurchargeAmount(1999, 250, 'USD')).toBe(50);
      expect(planCardSurcharge({ type: 'CLASS_PACK', price: 99900 }, 300, 'JPY')).toBe(3000); // ¥29.97 → ¥30
      expect(planCardSurcharge({ type: 'FRIEND_PASS', price: 0 }, 300, 'JPY')).toBe(0);
    });
  });
});
