import { balanceBilledCancelAt, isBalanceBilled, membershipBillingEndDay, takesCards } from './membership-series';

describe('membership-series (Decision 441 item 1)', () => {
  describe('isBalanceBilled', () => {
    it('only a paid monthly plan at a School whose payment account is not Stripe', () => {
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 100 }, { provider: 'BANK_TRANSFER' })).toBe(true);
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 100 }, { provider: 'CASH' })).toBe(true);
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 100 }, { provider: 'STRIPE' })).toBe(false);
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 100 }, null)).toBe(false);
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 0 }, { provider: 'CASH' })).toBe(false);
      expect(isBalanceBilled({ type: 'CLASS_PACK', price: 100 }, { provider: 'CASH' })).toBe(false);
      expect(takesCards({ provider: 'STRIPE' })).toBe(true);
      expect(takesCards(null)).toBe(false);
    });
  });

  describe('balanceBilledCancelAt', () => {
    const start = new Date('2027-01-31T15:00:00Z');

    it('ends at the start of the next billing day, on the same day of the month (the last day of a shorter month)', () => {
      expect(balanceBilledCancelAt(start, 'UTC', new Date('2027-02-10T10:00:00Z')).toISOString()).toBe('2027-02-28T00:00:00.000Z');
      expect(balanceBilledCancelAt(start, 'UTC', new Date('2027-03-05T10:00:00Z')).toISOString()).toBe('2027-03-31T00:00:00.000Z');
    });

    it('cancelled on the first day, it runs to the first billing day', () => {
      expect(balanceBilledCancelAt(start, 'UTC', new Date('2027-01-31T16:00:00Z')).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    });

    it('cancelled on a billing day, that month is kept and it ends at the next one', () => {
      expect(balanceBilledCancelAt(start, 'UTC', new Date('2027-02-28T09:00:00Z')).toISOString()).toBe('2027-03-31T00:00:00.000Z');
    });

    it("counts days in the School's time zone", () => {
      // 1 Mar 01:00 UTC is still 28 Feb in São Paulo (UTC-3): a billing day there.
      const sp = new Date('2027-01-31T15:00:00Z');
      expect(balanceBilledCancelAt(sp, 'America/Sao_Paulo', new Date('2027-03-01T01:00:00Z')).toISOString()).toBe('2027-03-31T03:00:00.000Z');
    });
  });

  describe('membershipBillingEndDay', () => {
    const live = { status: 'ACTIVE', cancelAt: null, expiryDate: null };

    it('runs while active and not cancelled', () => {
      expect(membershipBillingEndDay(live, 'UTC', '2027-03-01')).toBeNull();
    });

    it('stops on its cancel or end day, whichever comes first', () => {
      expect(membershipBillingEndDay({ ...live, cancelAt: new Date('2027-04-01T00:00:00Z'), expiryDate: new Date('2027-03-15T10:00:00Z') }, 'UTC', '2027-03-01')).toBe('2027-03-15');
      expect(membershipBillingEndDay({ ...live, cancelAt: new Date('2027-04-01T03:00:00Z') }, 'America/Sao_Paulo', '2027-03-01')).toBe('2027-04-01');
    });

    it('stops today once the membership is no longer active, or is gone', () => {
      expect(membershipBillingEndDay({ ...live, status: 'EXPIRED' }, 'UTC', '2027-03-01')).toBe('2027-03-01');
      expect(membershipBillingEndDay(null, 'UTC', '2027-03-01')).toBe('2027-03-01');
    });
  });
});
