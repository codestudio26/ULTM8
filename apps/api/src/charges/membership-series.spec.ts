import type { RecurringCharge } from '@prisma/client';
import { balanceBilledCancelAt, isBalanceBilled, membershipBillingEndDay, syncSeriesFreezes, takesCards } from './membership-series';

describe('membership-series (Decision 441 item 1)', () => {
  describe('isBalanceBilled', () => {
    const ready = { provider: 'STRIPE', stripeConnectedAccountId: 'acct_1', stripeAccountReady: true };
    const none = { stripeConnectedAccountId: null, stripeAccountReady: false };
    it('only a paid monthly plan at a School that takes no cards', () => {
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 100 }, { provider: 'BANK_TRANSFER', ...none })).toBe(true);
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 100 }, { provider: 'CASH', ...none })).toBe(true);
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 100 }, ready)).toBe(false);
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 100 }, null)).toBe(false);
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 0 }, { provider: 'CASH', ...none })).toBe(false);
      expect(isBalanceBilled({ type: 'CLASS_PACK', price: 100 }, { provider: 'CASH', ...none })).toBe(false);
    });

    it('Decision 442 item 2: a Stripe account takes cards only once Stripe says it is ready', () => {
      expect(takesCards(ready)).toBe(true);
      expect(takesCards(null)).toBe(false);
      expect(takesCards({ ...ready, stripeAccountReady: false })).toBe(false);
      expect(takesCards({ ...ready, stripeConnectedAccountId: null })).toBe(false);
      expect(takesCards({ ...ready, provider: 'CASH' })).toBe(false);
      expect(isBalanceBilled({ type: 'SUBSCRIPTION', price: 100 }, { ...ready, stripeAccountReady: false })).toBe(true);
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

    it('Decision 442 item 5: follows the series once a freeze has moved it', () => {
      // Moved to the 20th: the next billing day after 10 Mar is 20 Mar, and
      // during the freeze (before the new first date) it is that first date.
      const moved = { firstDate: new Date('2027-02-20T00:00:00Z'), nextIndex: 1 };
      expect(balanceBilledCancelAt(start, 'UTC', new Date('2027-03-10T10:00:00Z'), moved).toISOString()).toBe('2027-03-20T00:00:00.000Z');
      expect(balanceBilledCancelAt(start, 'UTC', new Date('2027-03-25T10:00:00Z'), moved).toISOString()).toBe('2027-04-20T00:00:00.000Z');
      // An unmoved series starts on the start day: the same answer as without it.
      const unmoved = { firstDate: new Date('2027-01-31T00:00:00Z'), nextIndex: 1 };
      expect(balanceBilledCancelAt(start, 'UTC', new Date('2027-02-10T10:00:00Z'), unmoved).toISOString()).toBe('2027-02-28T00:00:00.000Z');
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

  describe('syncSeriesFreezes (Decision 442 item 5)', () => {
    const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
    const NOW = new Date('2027-03-05T12:00:00Z');

    function series(next: string, extra: Partial<RecurringCharge> = {}): RecurringCharge {
      return {
        id: 'rc-1', membershipId: 'm-1', schoolId: 's-1', studentId: 'u-1', frequency: 'MONTHLY', firstDate: day('2027-01-15'), endDate: null,
        maxOccurrences: null, nextIndex: 2, createdCount: 1, nextDate: day(next), stoppedAt: null, ...extra,
      } as RecurringCharge;
    }

    function freeze(startsAt: string, endsAt: string, extra: Record<string, unknown> = {}) {
      return { id: 'f-1', status: 'APPROVED', startsAt: day(startsAt), endsAt: day(endsAt), endedEarlyAt: null, billingShiftAppliedAt: null, billingRestoredAt: null, ...extra };
    }

    function txWith(freezes: unknown[]) {
      return {
        membershipFreeze: { findMany: jest.fn().mockResolvedValue(freezes), update: jest.fn().mockResolvedValue({}) },
        recurringCharge: { update: jest.fn(async ({ data }) => ({ ...series('2027-03-15'), ...data })) },
        membership: {},
      };
    }

    it('moves the next month later by the freeze length, and the months after follow from there', async () => {
      const tx = txWith([freeze('2027-03-10', '2027-04-09')]);
      const after = await syncSeriesFreezes(tx as never, series('2027-03-15'), 'UTC', NOW);
      expect(tx.recurringCharge.update).toHaveBeenCalledWith({ where: { id: 'rc-1' }, data: { firstDate: day('2027-02-14'), nextIndex: 2, nextDate: day('2027-04-14') } });
      expect(after.nextDate).toEqual(day('2027-04-14'));
      expect(tx.membershipFreeze.update).toHaveBeenCalledWith({ where: { id: 'f-1' }, data: { billingShiftAppliedAt: NOW } });
    });

    it('a month due before the first frozen day is charged first: nothing moves yet', async () => {
      const tx = txWith([freeze('2027-03-20', '2027-04-19')]);
      await syncSeriesFreezes(tx as never, series('2027-03-15'), 'UTC', NOW);
      expect(tx.recurringCharge.update).not.toHaveBeenCalled();
      expect(tx.membershipFreeze.update).not.toHaveBeenCalled();
    });

    it('ended early: moves back by the frozen days not used, never before today', async () => {
      const tx = txWith([freeze('2027-03-01', '2027-03-31', { endedEarlyAt: new Date('2027-03-05T09:00:00Z'), billingShiftAppliedAt: NOW })]);
      // Moved from 15 Mar to 14 Apr; back on 5 Mar, so 26 days unused: 19 Mar.
      await syncSeriesFreezes(tx as never, series('2027-04-14', { firstDate: day('2027-03-14'), nextIndex: 1 }), 'UTC', NOW);
      expect(tx.recurringCharge.update).toHaveBeenCalledWith({ where: { id: 'rc-1' }, data: { firstDate: day('2027-02-19'), nextIndex: 1, nextDate: day('2027-03-19') } });
      expect(tx.membershipFreeze.update).toHaveBeenCalledWith({ where: { id: 'f-1' }, data: { billingRestoredAt: NOW } });
    });

    it('ended before it started and never moved: nothing moves', async () => {
      const tx = txWith([freeze('2027-03-20', '2027-04-19', { endedEarlyAt: new Date('2027-03-05T09:00:00Z') })]);
      await syncSeriesFreezes(tx as never, series('2027-03-25'), 'UTC', NOW);
      expect(tx.recurringCharge.update).not.toHaveBeenCalled();
      expect(tx.membershipFreeze.update).toHaveBeenCalledWith({ where: { id: 'f-1' }, data: { billingShiftAppliedAt: NOW, billingRestoredAt: NOW } });
    });

    it('a series that has ended (the membership was cancelled) is not moved', async () => {
      const tx = txWith([freeze('2027-03-10', '2027-04-09')]);
      await syncSeriesFreezes(tx as never, series('2027-03-15', { nextDate: null, endDate: day('2027-03-14') }), 'UTC', NOW);
      expect(tx.recurringCharge.update).not.toHaveBeenCalled();
      expect(tx.membershipFreeze.update).toHaveBeenCalledWith({ where: { id: 'f-1' }, data: { billingShiftAppliedAt: NOW } });
    });

    it('a series not tied to a membership is left alone', async () => {
      const tx = txWith([]);
      const row = series('2027-03-15', { membershipId: null });
      expect(await syncSeriesFreezes(tx as never, row, 'UTC', NOW)).toBe(row);
      expect(tx.membershipFreeze.findMany).not.toHaveBeenCalled();
    });
  });
});
