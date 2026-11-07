import { Prisma, Transaction } from '@prisma/client';
import { randomUUID } from 'crypto';
import { assertCanCreateMembership, GeneralAccessConflictError } from './membership-creation-guard';
import { membershipTerm } from './plan-term';
import { lockPlanPlaces, planFullFor } from './waitlist/plan-capacity';
import { planSwitchEndedNotice, planSwitchedNotice } from './plan-switch-notices';
import { chargeNoticeSwitches, noticeMoney, refusedPurchaseRefundNotice } from '../charges/charge-ledger';
import type { NotificationFanoutJobData } from '../jobs/notification-fanout.types';

/**
 * Decision 447 item 4 (#518's follow-up): a membership bought with the
 * member's saved card off-session, with no one on the other end to confirm
 * it: a saved-card purchase (MembershipsService.purchaseWithSavedCard) or a
 * plan switch (PlanSwitchProcessor). As for automatic charge payments
 * (Decision 446 item 5), the Transaction is written Pending first
 * (offSessionAttempt, and for a switch planSwitchFromMembershipId), and the
 * PaymentIntent carries its id in its metadata and its idempotency key. So a
 * payment Stripe took is never lost if the caller stops before saving the
 * answer: whichever comes first of the caller, Stripe's payment_intent.*
 * webhook and the stale-attempt sweep (ChargeAutoPayProcessor) settles it,
 * and the Membership is created exactly once, by the one that turns the row
 * Successful (settleOffSessionPurchase()).
 */
export const OFF_SESSION_PURCHASE = { kind: 'MEMBERSHIP', paymentMethod: 'STRIPE', offSessionAttempt: true } satisfies Prisma.TransactionWhereInput;

/**
 * The Membership can't be made after all (the member holds general access
 * now, or, for a plan switch, the next plan is full: Decision 447 item 5):
 * the payment is refunded (refuseOffSessionPurchase()). Thrown inside the
 * settling transaction, so it rolls back and the row stays as it was.
 */
export class OffSessionPurchaseRefusedError extends Error {}

type Tx = Prisma.TransactionClient;

/**
 * Paid: turns the Pending (or Failed: paid after all) row Successful and
 * creates its Membership, in the caller's transaction. Null when another
 * settler already did. For a plan switch, the next plan's member limit is
 * counted again under its lock first (Decision 447 item 5, as orders,
 * Decision 446 item 6), and the switch is recorded on the membership that
 * ended. `zone` is the School's time zone (an N-day pass ends on calendar
 * days there). `refuseClosedSchool` (the jobs connection only, which may lock
 * the School row) refuses it at a School closed since.
 */
export async function settleOffSessionPurchase(
  tx: Tx,
  transactionId: string,
  paymentIntentId: string | null,
  zone: string | null,
  now: Date = new Date(),
  opts: { refuseClosedSchool?: boolean } = {},
): Promise<{ membershipId: string; transaction: Transaction } | null> {
  if (paymentIntentId) {
    await tx.transaction.updateMany({ where: { id: transactionId, stripePaymentIntentId: null }, data: { stripePaymentIntentId: paymentIntentId } });
  }
  const flipped = await tx.transaction.updateMany({ where: { id: transactionId, ...OFF_SESSION_PURCHASE, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'SUCCESSFUL' } });
  if (flipped.count === 0) return null;
  const transaction = await tx.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (opts.refuseClosedSchool) {
    // Decision 334 §8 / 364 §2, as Stripe's webhook refuses it: a School
    // closed since takes no purchase (FOR SHARE waits for a close in flight).
    const [school] = await tx.$queryRaw<{ archivedAt: Date | null }[]>`SELECT "archivedAt" FROM "School" WHERE id = ${transaction.schoolId} FOR SHARE`;
    if (school?.archivedAt) throw new OffSessionPurchaseRefusedError(`School ${transaction.schoolId} is closed.`);
  }
  const plan = await tx.membershipPlan.findUniqueOrThrow({ where: { id: transaction.membershipPlanId! } });
  if (transaction.planSwitchFromMembershipId) {
    await lockPlanPlaces(tx, plan);
    if (await planFullFor(tx, plan, transaction.studentId, now)) {
      throw new OffSessionPurchaseRefusedError(`Plan ${plan.id} is full under its member limit.`);
    }
  }
  try {
    await assertCanCreateMembership(tx, transaction.studentId, transaction.schoolId, plan, now);
  } catch (err) {
    if (err instanceof GeneralAccessConflictError) throw new OffSessionPurchaseRefusedError(err.message);
    throw err;
  }
  const term = membershipTerm(plan, zone, now);
  const membership = await tx.membership.create({
    data: {
      id: randomUUID(),
      studentId: transaction.studentId,
      membershipPlanId: plan.id,
      schoolId: transaction.schoolId,
      // Never a Subscription: those are paid through their own first invoice.
      frequency: 'ONE_TIME',
      classesRemaining: plan.classesIncluded ?? undefined,
      startDate: term.startDate,
      expiryDate: term.expiryDate,
      awaitingFirstCheckIn: term.awaitingFirstCheckIn,
      scopedClassId: plan.scopedClassId,
      // Decision 435 item 9: the switch the member agreed to when buying.
      ...(transaction.planSwitchToPlanId ? { switchToPlanId: transaction.planSwitchToPlanId, switchAgreedAt: transaction.createdAt } : {}),
    },
  });
  await tx.transaction.update({ where: { id: transactionId }, data: { membershipId: membership.id } });
  if (transaction.planSwitchFromMembershipId) {
    await tx.membership.updateMany({
      where: { id: transaction.planSwitchFromMembershipId, OR: [{ switchOutcome: null }, { switchOutcome: 'DECLINED' }] },
      data: { switchOutcome: 'SWITCHED', switchedToMembershipId: membership.id },
    });
  }
  return { membershipId: membership.id, transaction };
}

/** Declined, or never made: the Pending row turns Failed (a plan switch ends
 * as declined). Null when it was settled already. */
export async function failOffSessionPurchase(tx: Tx, transactionId: string, paymentIntentId: string | null): Promise<Transaction | null> {
  if (paymentIntentId) {
    await tx.transaction.updateMany({ where: { id: transactionId, stripePaymentIntentId: null }, data: { stripePaymentIntentId: paymentIntentId } });
  }
  const flipped = await tx.transaction.updateMany({ where: { id: transactionId, ...OFF_SESSION_PURCHASE, status: 'PENDING' }, data: { status: 'FAILED' } });
  if (flipped.count === 0) return null;
  const transaction = await tx.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (transaction.planSwitchFromMembershipId) {
    await tx.membership.updateMany({ where: { id: transaction.planSwitchFromMembershipId, switchOutcome: null }, data: { switchOutcome: 'DECLINED' } });
  }
  return transaction;
}

/** Paid, but the Membership was refused, and the caller refunded the
 * PaymentIntent in full: the row is Refunded (price and surcharge), and a plan
 * switch ends as not sold. Null when it was settled already. */
export async function refuseOffSessionPurchase(tx: Tx, transactionId: string, paymentIntentId: string): Promise<Transaction | null> {
  const row = await tx.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  const flipped = await tx.transaction.updateMany({
    where: { id: transactionId, ...OFF_SESSION_PURCHASE, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'REFUNDED', refundedAmount: row.amount + row.surchargeAmount, stripePaymentIntentId: paymentIntentId },
  });
  if (flipped.count === 0) return null;
  if (row.planSwitchFromMembershipId) {
    await tx.membership.updateMany({ where: { id: row.planSwitchFromMembershipId, OR: [{ switchOutcome: null }, { switchOutcome: 'DECLINED' }] }, data: { switchOutcome: 'NOT_SOLD' } });
  }
  return row;
}

type NoticeDb = Pick<Prisma.TransactionClient, 'membership' | 'membershipPlan' | 'school'>;

/**
 * The member's notice for an off-session purchase settled by Stripe's
 * webhook or the stale-attempt sweep (the caller sends its own when it saves
 * the answer itself), with the same keys as the caller's, so a member is told
 * once. A plan switch: "Your plan has changed", or "Membership ended" when it
 * was declined or refused. A saved-card purchase refused and refunded: the
 * "Refund" notice (Decision 415 item 4), unless the School switched refund
 * notices off. Nothing else: the member who bought it was answered at the
 * time.
 */
export async function offSessionPurchaseNotices(db: NoticeDb, row: Transaction, outcome: 'paid' | 'failed' | 'refunded'): Promise<NotificationFanoutJobData[]> {
  if (row.planSwitchFromMembershipId) {
    const ended = await db.membership.findUnique({ where: { id: row.planSwitchFromMembershipId }, select: { id: true, membershipPlan: { select: { title: true } } } });
    const next = row.membershipPlanId ? await db.membershipPlan.findUnique({ where: { id: row.membershipPlanId }, select: { title: true } }) : null;
    if (!ended || !next) return [];
    const base = { userId: row.studentId, type: 'MEMBERSHIP_EXPIRY', schoolId: row.schoolId };
    if (outcome === 'paid') {
      if (!row.currency) return [];
      const notice = planSwitchedNotice(ended.membershipPlan.title, next.title, noticeMoney(row.amount + row.surchargeAmount, row.currency));
      return [{ ...base, notificationId: `plan-switched-${ended.id}`, title: notice.title, body: notice.body }];
    }
    const notice = planSwitchEndedNotice(ended.membershipPlan.title, next.title);
    return [{ ...base, notificationId: `plan-switch-ended-${ended.id}`, title: notice.title, body: notice.body }];
  }
  if (outcome !== 'refunded' || !row.currency) return [];
  if (!(await chargeNoticeSwitches(db, row.schoolId)).refund) return [];
  const plan = row.membershipPlanId ? await db.membershipPlan.findUnique({ where: { id: row.membershipPlanId }, select: { title: true } }) : null;
  const notice = refusedPurchaseRefundNotice(`refund-refused-${row.id}`, row.amount + row.surchargeAmount, row.currency, plan?.title ?? 'the membership');
  return [{ notificationId: notice.key, userId: row.studentId, title: notice.title, body: notice.body, type: 'REFUND', schoolId: row.schoolId, targetType: 'PAYMENT' }];
}
