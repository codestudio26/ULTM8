import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { NoSavedPaymentMethodError } from '../payments/payments.service';

/**
 * Decision 236's own follow-up — MembershipsService.purchase()'s
 * payWithSavedCard branch (purchaseWithSavedCard, private — called here via
 * direct cast, same technique PaymentsService's own spec file uses for its
 * private resolveStripePaymentAccount()). The HTTP-reachable blocking paths
 * (step-up missing/invalid, no saved card, SUBSCRIPTION/Guardian/Cash-Bank
 * scope blocks) are covered end-to-end in memberships.e2e-spec.ts against a
 * real Postgres; this file covers the one branch that e2e cannot reach
 * without a real Stripe call — what happens once chargeOffSession() already
 * succeeded, synchronously, before the Membership-creation race is even
 * attempted: a clean success, and the collision-triggers-a-refund case.
 */
describe('MembershipsService.purchaseWithSavedCard (Decision 236)', () => {
  function makeTx(overrides: { membershipCreate?: jest.Mock; transactionCreate?: jest.Mock; transactionUpdate?: jest.Mock } = {}) {
    return {
      membership: { create: overrides.membershipCreate ?? jest.fn().mockResolvedValue({ id: 'membership-1' }) },
      transaction: {
        create: overrides.transactionCreate ?? jest.fn().mockResolvedValue({ id: 'transaction-1' }),
        update: overrides.transactionUpdate ?? jest.fn().mockResolvedValue({}),
      },
    };
  }

  function makeService(opts: {
    tx: ReturnType<typeof makeTx>;
    chargeOffSession: jest.Mock;
    refundOffSessionCharge?: jest.Mock;
    assertVerified?: jest.Mock;
  }) {
    const prismaApp = { withTenantContext: jest.fn((_userId: string, cb: (tx: unknown) => unknown) => cb(opts.tx)) };
    const paymentsService = {
      chargeOffSession: opts.chargeOffSession,
      refundOffSessionCharge: opts.refundOffSessionCharge ?? jest.fn().mockResolvedValue(undefined),
    };
    const stepUpService = { assertVerified: opts.assertVerified ?? jest.fn() };
    const service = new MembershipsService(
      prismaApp as never,
      null as never,
      null as never,
      paymentsService as never,
      null as never,
      null as never,
      stepUpService as never,
      // v1.2 backend backlog — the price-migration queue injection
      // (@InjectQueue(MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE)); unused by the
      // purchaseWithSavedCard path this spec file exercises, same "null as
      // never for a dependency this test's code path never touches"
      // convention every other argument here already follows.
      null as never,
    );
    return { service, prismaApp, paymentsService, stepUpService };
  }

  interface FixturePlan {
    id: string;
    schoolId: string;
    type: string;
    classesIncluded: number | null;
    expiryDurationDays: number | null;
    scopedClassId: string | null;
    price: number;
    title: string;
  }

  const plan: FixturePlan = {
    id: 'plan-1',
    schoolId: 'school-1',
    type: 'CLASS_PACK',
    classesIncluded: 5,
    expiryDurationDays: null,
    scopedClassId: null,
    price: 3000,
    title: 'Pack',
  };

  function callPurchaseWithSavedCard(service: MembershipsService, stepUpToken?: string) {
    return (
      service as unknown as {
        purchaseWithSavedCard: (
          studentId: string,
          callerId: string,
          plan: FixturePlan,
          paymentAccountId: string,
          currency: string,
          stepUpToken?: string,
        ) => Promise<unknown>;
      }
    ).purchaseWithSavedCard('student-1', 'student-1', plan, 'account-1', 'usd', stepUpToken);
  }

  it('checks step-up BEFORE ever calling chargeOffSession', async () => {
    const assertVerified = jest.fn(() => {
      throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Re-enter your passcode to confirm this action.' });
    });
    const chargeOffSession = jest.fn();
    const { service } = makeService({ tx: makeTx(), chargeOffSession, assertVerified });

    await expect(callPurchaseWithSavedCard(service, undefined)).rejects.toBeInstanceOf(ForbiddenException);
    expect(chargeOffSession).not.toHaveBeenCalled();
  });

  it('maps NoSavedPaymentMethodError to a clear 400, without creating any Transaction row', async () => {
    const chargeOffSession = jest.fn().mockRejectedValue(new NoSavedPaymentMethodError('none saved'));
    const tx = makeTx();
    const { service } = makeService({ tx, chargeOffSession });

    await expect(callPurchaseWithSavedCard(service, 'valid-token')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it('records a FAILED Transaction and throws 400 when the saved card is declined', async () => {
    const chargeOffSession = jest.fn().mockResolvedValue({ succeeded: false, paymentIntentId: 'pi_declined' });
    const tx = makeTx();
    const { service } = makeService({ tx, chargeOffSession });

    await expect(callPurchaseWithSavedCard(service, 'valid-token')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', stripePaymentIntentId: 'pi_declined' }) }),
    );
  });

  it('on a clean success, records a SUCCESSFUL Transaction, creates the Membership, and links the two', async () => {
    const chargeOffSession = jest.fn().mockResolvedValue({ succeeded: true, paymentIntentId: 'pi_ok' });
    const tx = makeTx();
    const { service } = makeService({ tx, chargeOffSession });

    const result = (await callPurchaseWithSavedCard(service, 'valid-token')) as { outcome: string; membership: { id: string }; transactionId: string };

    expect(result.outcome).toBe('active');
    expect(result.membership).toEqual({ id: 'membership-1' });
    expect(typeof result.transactionId).toBe('string');
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: result.transactionId, status: 'SUCCESSFUL', stripePaymentIntentId: 'pi_ok' }) }),
    );
    expect(tx.transaction.update).toHaveBeenCalledWith({ where: { id: result.transactionId }, data: { membershipId: 'membership-1' } });
  });

  it('refunds the already-captured charge and marks the Transaction REFUNDED when Membership creation loses the two-simultaneous-Active race', async () => {
    const chargeOffSession = jest.fn().mockResolvedValue({ succeeded: true, paymentIntentId: 'pi_collision' });
    const refundOffSessionCharge = jest.fn().mockResolvedValue(undefined);
    const tx = makeTx({ membershipCreate: jest.fn().mockRejectedValue({ code: 'P2002' }) });
    const { service, paymentsService } = makeService({ tx, chargeOffSession, refundOffSessionCharge });

    await expect(callPurchaseWithSavedCard(service, 'valid-token')).rejects.toBeInstanceOf(ConflictException);

    expect(paymentsService.refundOffSessionCharge).toHaveBeenCalledWith('student-1', 'school-1', 'pi_collision');
    const createdTransactionId = tx.transaction.create.mock.calls[0][0].data.id;
    expect(tx.transaction.update).toHaveBeenCalledWith({
      where: { id: createdTransactionId },
      data: { status: 'REFUNDED', refundedAmount: plan.price },
    });
  });
});
