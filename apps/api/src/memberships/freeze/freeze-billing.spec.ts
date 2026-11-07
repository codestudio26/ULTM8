import { applyFreezeBillingAfterRenewal, applyFreezeBillingShift, restoreFreezeBilling } from './freeze-billing';

/**
 * Decision 409: when a freeze's billing shift goes to Stripe, and how an
 * early end takes it back. The database and Stripe are in-memory stubs; the
 * e2e suite (test/membership-freeze.e2e-spec.ts) runs the same paths against
 * Postgres.
 */
const DAY_S = 24 * 60 * 60;
const NOW = new Date('2026-11-02T10:00:00.000Z');
const nowS = NOW.getTime() / 1000;
const date = (day: string) => new Date(`${day}T00:00:00.000Z`);

type Row = {
  id: string;
  membershipId: string;
  schoolId: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  endedEarlyAt: Date | null;
  shiftedTrialEnd: Date | null;
  billingShiftAppliedAt: Date | null;
  restoredTrialEnd: Date | null;
  billingRestoredAt: Date | null;
};

function setup(
  freezes: Array<Partial<Row> & Pick<Row, 'id' | 'startsAt' | 'endsAt'>>,
  sub: { periodEnd: number; trialEnd?: number | null; status?: string },
  membership: { cancelAt: Date | null } = { cancelAt: null },
) {
  const rows = new Map<string, Row>(
    freezes.map((f) => [
      f.id,
      {
        membershipId: 'm1',
        schoolId: 's1',
        status: 'APPROVED',
        endedEarlyAt: null,
        shiftedTrialEnd: null,
        billingShiftAppliedAt: null,
        restoredTrialEnd: null,
        billingRestoredAt: null,
        ...f,
      },
    ]),
  );
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'id' || k === 'membershipId' || k === 'status') return (row as Record<string, unknown>)[k] === v;
      if (k === 'endsAt') return row.endsAt > (v as { gt: Date }).gt;
      return (row as Record<string, unknown>)[k] === v; // null checks
    });
  const db = {
    membershipFreeze: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const r = rows.get(where.id);
        return r ? { ...r, membership: { stripeSubscriptionId: 'sub_1', status: 'ACTIVE', cancelAt: membership.cancelAt }, school: { timezone: null } } : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({ ...rows.get(where.id)! })),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => [...rows.values()].filter((r) => matches(r, where)).map((r) => ({ id: r.id }))),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const r = rows.get(where.id as string)!;
        if (!matches(r, where)) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
    paymentAccount: { findUnique: jest.fn(async () => ({ provider: 'STRIPE', stripeConnectedAccountId: 'acct_1' })) },
    school: {},
    membership: {
      updateMany: jest.fn(async ({ where, data }: { where: { cancelAt: Date }; data: { cancelAt: Date } }) => {
        if (membership.cancelAt?.getTime() !== where.cancelAt.getTime()) return { count: 0 };
        membership.cancelAt = data.cancelAt;
        return { count: 1 };
      }),
    },
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const state = { trialEnd: sub.trialEnd ?? null, periodEnd: sub.periodEnd };
  const update = jest.fn(async (_id: string, params: { trial_end: number }) => {
    state.trialEnd = params.trial_end;
    return {};
  });
  const stripe = {
    scopedClient: () => ({
      subscriptions: {
        retrieve: async () => ({ status: sub.status ?? 'active', trial_end: state.trialEnd, items: { data: [{ current_period_end: state.periodEnd }] } }),
        update,
      },
    }),
  };
  return { db: db as never, stripe: stripe as never, rows, update, state, membership };
}

describe('freeze billing timing (Decision 409)', () => {
  it('shifts at approval when the paid period runs to the freeze start or later', async () => {
    const paid = nowS + 20 * DAY_S;
    const { db, stripe, update, rows } = setup([{ id: 'f1', startsAt: date('2026-11-05'), endsAt: date('2026-11-15') }], { periodEnd: paid });
    expect(await applyFreezeBillingShift(db, stripe, 'f1', NOW)).toBe(true);
    expect(update).toHaveBeenCalledWith('sub_1', { trial_end: paid + 10 * DAY_S, proration_behavior: 'none' }, { idempotencyKey: `membership-freeze-shift-f1-${paid + 10 * DAY_S}` });
    expect(rows.get('f1')!.billingShiftAppliedAt).toEqual(NOW);
    // Never twice.
    expect(await applyFreezeBillingShift(db, stripe, 'f1', NOW)).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('a renewal on the first frozen day counts as "no renewal before the freeze": shifted at approval', async () => {
    // Paid until 06:00 on the first frozen day (UTC School).
    const paid = date('2026-11-05').getTime() / 1000 + 6 * 3600;
    const { db, stripe, update } = setup([{ id: 'f1', startsAt: date('2026-11-05'), endsAt: date('2026-11-15') }], { periodEnd: paid });
    expect(await applyFreezeBillingShift(db, stripe, 'f1', NOW)).toBe(true);
    expect(update.mock.calls[0][1]).toEqual({ trial_end: paid + 10 * DAY_S, proration_behavior: 'none' });
  });

  it('waits when a renewal falls before the freeze, then shifts after it (the renewal webhook) or on the start day (the sweep)', async () => {
    const { db, stripe, update, state, rows } = setup([{ id: 'f1', startsAt: date('2026-11-05'), endsAt: date('2026-11-15') }], { periodEnd: nowS + DAY_S });
    expect(await applyFreezeBillingShift(db, stripe, 'f1', NOW)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(rows.get('f1')!.shiftedTrialEnd).toBeNull();

    // The renewal is paid: the new period ends after the freeze start.
    state.periodEnd = nowS + 31 * DAY_S;
    expect(await applyFreezeBillingAfterRenewal(db, stripe, { error: jest.fn() }, 'm1', NOW)).toBe(1);
    expect(update).toHaveBeenCalledWith('sub_1', { trial_end: nowS + 41 * DAY_S, proration_behavior: 'none' }, expect.anything());
  });

  it('on the start day it shifts whatever the paid period', async () => {
    const paid = nowS - 3600; // renewal overdue (Stripe retrying)
    const { db, stripe, update } = setup([{ id: 'f1', startsAt: date('2026-11-02'), endsAt: date('2026-11-12') }], { periodEnd: paid });
    expect(await applyFreezeBillingShift(db, stripe, 'f1', NOW)).toBe(true);
    expect(update.mock.calls[0][1].trial_end).toBe(paid + 10 * DAY_S);
  });

  it('a freeze ended early, or not approved, is never shifted', async () => {
    const { db, stripe, update } = setup(
      [
        { id: 'ended', startsAt: date('2026-11-05'), endsAt: date('2026-11-15'), endedEarlyAt: NOW },
        { id: 'asked', startsAt: date('2026-11-05'), endsAt: date('2026-11-15'), status: 'REQUESTED' },
        { id: 'declined', startsAt: date('2026-11-05'), endsAt: date('2026-11-15'), status: 'DECLINED' },
      ],
      { periodEnd: nowS + 20 * DAY_S },
    );
    for (const id of ['ended', 'asked', 'declined']) expect(await applyFreezeBillingShift(db, stripe, id, NOW)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('ended before it started after the shift was sent: back to the paid period end; mid-freeze: back by the days not used', async () => {
    const paid = nowS + 20 * DAY_S;
    const before = setup([{ id: 'f1', startsAt: date('2026-11-05'), endsAt: date('2026-11-15') }], { periodEnd: paid });
    await applyFreezeBillingShift(before.db, before.stripe, 'f1', NOW);
    before.rows.get('f1')!.endedEarlyAt = NOW;
    expect(await restoreFreezeBilling(before.db, before.stripe, 'f1', NOW)).toBe(true);
    expect(before.update.mock.calls[1]).toEqual(['sub_1', { trial_end: paid, proration_behavior: 'none' }, { idempotencyKey: `membership-freeze-restore-f1-${paid}` }]);
    expect(before.rows.get('f1')!.restoredTrialEnd).toEqual(new Date(paid * 1000));
    // A retry sends the saved value, never taking the days off twice.
    before.rows.get('f1')!.billingRestoredAt = null;
    await restoreFreezeBilling(before.db, before.stripe, 'f1', NOW);
    expect(before.update.mock.calls[2][1]).toEqual({ trial_end: paid, proration_behavior: 'none' });

    // Started on 1 Nov, 10 days; ended on 2 Nov: 1 day frozen, 9 unused.
    const mid = setup([{ id: 'f2', startsAt: date('2026-11-01'), endsAt: date('2026-11-11') }], { periodEnd: paid });
    await applyFreezeBillingShift(mid.db, mid.stripe, 'f2', NOW);
    mid.rows.get('f2')!.endedEarlyAt = NOW;
    await restoreFreezeBilling(mid.db, mid.stripe, 'f2', NOW);
    expect(mid.update.mock.calls[1][1]).toEqual({ trial_end: paid + DAY_S, proration_behavior: 'none' });
  });

  it('never moves the next charge back to less than a minute from now', async () => {
    const paid = nowS + 30; // paid period ends in 30 seconds
    const s = setup([{ id: 'f1', startsAt: date('2026-11-02'), endsAt: date('2026-11-12') }], { periodEnd: paid });
    await applyFreezeBillingShift(s.db, s.stripe, 'f1', NOW);
    s.rows.get('f1')!.endedEarlyAt = NOW;
    await restoreFreezeBilling(s.db, s.stripe, 'f1', NOW);
    expect(s.update.mock.calls[1][1].trial_end).toBe(Math.floor((NOW.getTime() + 60_000) / 1000));
  });

  it('a later freeze shifted first keeps an earlier one added on top when it is ended', async () => {
    const paid = nowS + 60 * DAY_S;
    const s = setup(
      [
        { id: 'later', startsAt: date('2026-11-20'), endsAt: date('2026-11-30') },
        { id: 'earlier', startsAt: date('2026-11-05'), endsAt: date('2026-11-12') },
      ],
      { periodEnd: paid },
    );
    await applyFreezeBillingShift(s.db, s.stripe, 'later', NOW);
    await applyFreezeBillingShift(s.db, s.stripe, 'earlier', NOW);
    expect(s.state.trialEnd).toBe(paid + 17 * DAY_S);
    s.rows.get('later')!.endedEarlyAt = NOW;
    await restoreFreezeBilling(s.db, s.stripe, 'later', NOW);
    expect(s.state.trialEnd).toBe(paid + 7 * DAY_S);
  });

  it('Decision 446 item 2: cancelled during the freeze, then ended early: the cancel date moves back with the next charge', async () => {
    // Started on 1 Nov, 10 days; ended on 2 Nov: 9 days unused.
    const paid = nowS + 20 * DAY_S;
    const cancelAt = new Date((paid + 10 * DAY_S) * 1000); // cancelled at the moved period end
    const s = setup([{ id: 'f1', startsAt: date('2026-11-01'), endsAt: date('2026-11-11') }], { periodEnd: paid }, { cancelAt });
    await applyFreezeBillingShift(s.db, s.stripe, 'f1', NOW);
    s.rows.get('f1')!.endedEarlyAt = NOW;
    expect(await restoreFreezeBilling(s.db, s.stripe, 'f1', NOW)).toBe(true);
    const back = paid + DAY_S;
    expect(s.update.mock.calls[1]).toEqual(['sub_1', { trial_end: back, proration_behavior: 'none', cancel_at: back }, { idempotencyKey: `membership-freeze-restore-f1-${back}-${back}` }]);
    expect(s.membership.cancelAt).toEqual(new Date(back * 1000));
  });

  it('a cancel date on or before the first frozen day was not pushed by the freeze: it stays', async () => {
    const paid = nowS + 20 * DAY_S;
    const cancelAt = date('2026-11-01');
    const s = setup([{ id: 'f1', startsAt: date('2026-11-01'), endsAt: date('2026-11-11') }], { periodEnd: paid }, { cancelAt });
    await applyFreezeBillingShift(s.db, s.stripe, 'f1', NOW);
    s.rows.get('f1')!.endedEarlyAt = NOW;
    await restoreFreezeBilling(s.db, s.stripe, 'f1', NOW);
    expect(s.update.mock.calls[1][1]).toEqual({ trial_end: paid + DAY_S, proration_behavior: 'none' });
    expect(s.membership.cancelAt).toEqual(cancelAt);
  });
});
