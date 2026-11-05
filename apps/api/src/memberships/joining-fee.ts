import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Decision 316 item 3, as answered by Decision 435 items 1-6: the joining
 * fee on a plan.
 *
 * 1. Any paid plan can carry one (never a free plan, a Friend Pass or a
 *    visit pass, which are given, not bought).
 * 2. It is charged only on a member's first-ever plan at the School: never
 *    on a rejoin after a gap, never on a renewal (a Subscription's renewals
 *    never carry it: it is a one-off line on the first invoice only).
 * 3. It is added to that first payment (card, cash at the desk, or the
 *    member's own Cash/Bank order), never put on the balance separately.
 * 4. The plan's tax and card surcharge apply to it: it is part of the
 *    payment's amount, which the tax snapshot covers, and the surcharge is
 *    worked out on the price plus the fee.
 * 5. Refundable or not is set on each plan and copied onto the payment; a
 *    non-refundable fee is always left out of refunds.
 * 6. With the School's joining fees switched off, the amounts stay on the
 *    plans but nothing is charged.
 */

/** Plans never sold, so never "a first plan" and never carrying a fee: a
 * Friend Pass (given by the School) and a visit pass (Decision 391). */
export const NOT_A_FIRST_PLAN_TYPES = ['FRIEND_PASS', 'VISIT_PASS'] as const;

/** The largest amount a payment row can hold (a Postgres integer). */
const MAX_AMOUNT = 2147483647;

/** Refuses a joining fee on a plan that can't carry one (item 1). */
export function assertJoiningFeeAllowed(type: string, price: number, joiningFee: number | null | undefined): void {
  if (joiningFee === null || joiningFee === undefined) return;
  if ((NOT_A_FIRST_PLAN_TYPES as readonly string[]).includes(type) || price <= 0) {
    throw new BadRequestException({ code: 'JOINING_FEE_NEEDS_PRICE', message: 'Only a paid plan can have a joining fee.' });
  }
  if (price + joiningFee > MAX_AMOUNT) {
    throw new BadRequestException({ code: 'JOINING_FEE_TOO_BIG', message: 'The price and the joining fee together are too big.' });
  }
}

export interface JoiningFeeDue {
  /** What this payment adds for the joining fee, in the plan's minor units (0 = none). */
  amount: number;
  /** Whether it is refunded with the payment (the plan's setting). */
  refundable: boolean;
}

export const NO_JOINING_FEE: JoiningFeeDue = { amount: 0, refundable: false };

/**
 * The joining fee a payment for `plan` by `studentId` carries now: the plan's
 * fee when the School has joining fees on and this would be the member's
 * first-ever plan at the School, else none.
 *
 * "First-ever plan": no Membership at the School before, of any status (an
 * expired one is a rejoin), leaving out the Friend Passes and visit passes the
 * School gave, and no Cash/Bank order with a joining fee still waiting to be
 * confirmed (that order is the first plan). Read under the Student's own
 * context, as every purchase and desk sale already reads.
 */
export async function joiningFeeDue(
  tx: Pick<Prisma.TransactionClient, 'school' | 'membership' | 'transaction'>,
  studentId: string,
  plan: { schoolId: string; type: string; price: number; joiningFee: number | null; joiningFeeRefundable: boolean },
): Promise<JoiningFeeDue> {
  if (!plan.joiningFee || plan.joiningFee <= 0 || plan.price <= 0) return NO_JOINING_FEE;
  if ((NOT_A_FIRST_PLAN_TYPES as readonly string[]).includes(plan.type)) return NO_JOINING_FEE;
  const school = await tx.school.findUnique({ where: { id: plan.schoolId }, select: { joiningFeesEnabled: true } });
  if (!school?.joiningFeesEnabled) return NO_JOINING_FEE;
  const earlier = await tx.membership.findFirst({
    where: { studentId, schoolId: plan.schoolId, membershipPlan: { type: { notIn: [...NOT_A_FIRST_PLAN_TYPES] } } },
    select: { id: true },
  });
  if (earlier) return NO_JOINING_FEE;
  const waiting = await tx.transaction.findFirst({
    where: {
      studentId,
      schoolId: plan.schoolId,
      joiningFeeAmount: { gt: 0 },
      status: 'PENDING',
      paymentMethod: { in: ['CASH', 'BANK_TRANSFER'] },
    },
    select: { id: true },
  });
  if (waiting) return NO_JOINING_FEE;
  return { amount: plan.joiningFee, refundable: plan.joiningFeeRefundable };
}

/** The part of a payment that is never refunded: its joining fee when the
 * plan said it isn't refundable (item 5), else 0. */
export function nonRefundableJoiningFee(t: { joiningFeeAmount: number; joiningFeeRefundable: boolean }): number {
  return t.joiningFeeRefundable ? 0 : t.joiningFeeAmount;
}
