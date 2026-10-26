import { BadRequestException } from '@nestjs/common';
import { cancelSubscriptionAtPeriodEnd } from './cancel-subscription';

/** Decision 348 — the shared cancel used by MembershipsService and by
 * removing a Student (Students S2). The e2e test covers who may call it. */
describe('cancelSubscriptionAtPeriodEnd (Decision 348)', () => {
  const live = { id: 'm-1', schoolId: 'school-1', status: 'ACTIVE' as const, stripeSubscriptionId: 'sub_1', cancelAt: null };

  function setup(stripeReply: Record<string, unknown>) {
    const update = jest.fn().mockResolvedValue(stripeReply);
    const scopedClient = jest.fn().mockReturnValue({ subscriptions: { update } });
    const tx = {
      paymentAccount: { findUnique: jest.fn().mockResolvedValue({ stripeConnectedAccountId: 'acct_school' }) },
      membership: { update: jest.fn(async ({ data }) => ({ ...live, ...data })), findUniqueOrThrow: jest.fn().mockResolvedValue(live) },
    };
    return { update, scopedClient, tx };
  }

  it('sets cancel_at_period_end on the School\'s connected account and records cancel_at and who asked', async () => {
    const { update, scopedClient, tx } = setup({ cancel_at: 1_800_000_000, items: { data: [{ current_period_end: 1_700_000_000 }] } });
    const result = await cancelSubscriptionAtPeriodEnd({ scopedClient } as never, tx as never, live, 'owner-1');
    expect(scopedClient).toHaveBeenCalledWith('acct_school');
    expect(update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    expect(tx.membership.update).toHaveBeenCalledWith({ where: { id: 'm-1' }, data: { cancelAt: new Date(1_800_000_000 * 1000), cancelledById: 'owner-1' } });
    expect(result.cancelAt).toEqual(new Date(1_800_000_000 * 1000));
  });

  it('falls back to the item\'s period end when cancel_at is missing', async () => {
    const { tx, scopedClient } = setup({ cancel_at: null, items: { data: [{ current_period_end: 1_700_000_000 }] } });
    const result = await cancelSubscriptionAtPeriodEnd({ scopedClient } as never, tx as never, live, 'student-1');
    expect(result.cancelAt).toEqual(new Date(1_700_000_000 * 1000));
  });

  it('does nothing more when already cancelled, and refuses a plan that isn\'t a Subscription or has ended', async () => {
    const { tx, scopedClient, update } = setup({});
    await cancelSubscriptionAtPeriodEnd({ scopedClient } as never, tx as never, { ...live, cancelAt: new Date() }, 'x');
    expect(update).not.toHaveBeenCalled();
    await expect(cancelSubscriptionAtPeriodEnd({ scopedClient } as never, tx as never, { ...live, stripeSubscriptionId: null }, 'x')).rejects.toBeInstanceOf(BadRequestException);
    await expect(cancelSubscriptionAtPeriodEnd({ scopedClient } as never, tx as never, { ...live, status: 'EXPIRED' }, 'x')).rejects.toBeInstanceOf(BadRequestException);
  });
});
