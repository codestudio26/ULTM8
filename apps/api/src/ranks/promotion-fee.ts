import { PromotionFeeRequest, PromotionFeeStatus } from '@prisma/client';

/**
 * Promotion fee (Decisions 287, 300, 307, 313): shared shapes and the rules
 * for reading a request's state. See PromotionFeeRequest in schema.prisma.
 */

/** The grade a coach made, kept on the request while the promotion waits for
 * its fee or is "to decide" (Decision 307). Applied through the normal grading
 * path, with the coach's grading date (Decision 300 item 4). */
export interface PendingGrade {
  /** MOVE_TO_ADULT: a Kids student graded into the linked Adult program
   * (backlog 3.20; Decision 419 item 2). `targetRungId` is then a rank of the
   * Adult style (the request's `toDisciplineId`), applied through the move. */
  type: 'PROMOTION' | 'STRIPE_AWARD' | 'MOVE_TO_ADULT';
  targetRungId: string;
  expectedCurrentRungId: string | null;
  /** The grading date the coach chose (or the day they graded), YYYY-MM-DD in the student's local time. */
  effectiveDate: string;
  note: string | null;
  acknowledgeWithoutSkillSignoff: boolean;
  startingClasses?: number;
  startingClassesByType?: Record<string, number>;
  /** Set when the grade came from a bulk promote: its history type and note. */
  bulk?: { eventType: 'BULK_PROMOTION' | 'BULK_STRIPE_AWARD'; systemNote: string };
}

/** Statuses in which the payer has not settled the fee (no answer yet, or accepted and not paid). */
export const UNSETTLED_STATUSES: PromotionFeeStatus[] = ['PENDING', 'ACCEPTED'];

type RequestState = Pick<
  PromotionFeeRequest,
  'status' | 'promotionWaits' | 'promotionEventId' | 'toDecideAt' | 'toDecideResolvedAt' | 'expectedCurrentRungId' | 'toRungId' | 'promotionBlockedAt'
>;

/** The promotion waits for its fee ("Waiting for fee", Decision 300): not
 * applied, not "to decide", the fee not yet declined, waived or cancelled, and
 * not paid with a promotion that can no longer apply (isPromotionBlocked). */
export function isWaitingForFee(r: RequestState): boolean {
  return r.promotionWaits && r.promotionEventId === null && r.toDecideAt === null && r.promotionBlockedAt === null && UNSETTLED_STATUSES.includes(r.status);
}

/** The fee is paid but its waiting promotion can no longer apply (the
 * student's rank or the ladder changed since the grade), and the owner hasn't
 * decided yet: cancel the fee, or grade the student again (Decision 414 item 1).
 * It doesn't hold up grading: grading again is one of the owner's two choices. */
export function isPromotionBlocked(r: RequestState): boolean {
  return r.promotionBlockedAt !== null && r.status === 'ACCEPTED';
}

/** A planned promotion left for a coach to decide (Decision 307), still open. */
export function isOpenToDecide(r: RequestState): boolean {
  return r.toDecideAt !== null && r.toDecideResolvedAt === null;
}

export type FeeStatus = 'blocked' | 'waiting' | 'declined' | 'toDecide';

/**
 * What the Grading Board shows for one student in one style. Only requests
 * that still concern the student's current rung count, so an old request
 * doesn't stay on the card after the student has moved on:
 * - blocked: the fee is paid but its promotion can no longer apply (Decision
 *   414 item 1). Shown whatever the current rung: the rung having changed is
 *   usually why it can't apply. Until the owner cancels the fee or the
 *   student is graded again;
 * - waiting: the promotion waits for its fee (planned from the current rung);
 * - toDecide: a planned promotion from the current rung left for a coach;
 * - declined: the fee was declined — for a waiting promotion while the student
 *   is still on the rung it was planned from; for a promotion that already
 *   applied ("grade before paid" on), while they are still on that new rung.
 * The staleness rule (current rung) is this build's narrowest reading; the
 * decisions don't say when "Fee declined" stops showing. Needs product-owner
 * confirmation.
 */
export function feeStatusFor<T extends RequestState>(requests: T[], currentStripeId: string | null): { status: FeeStatus; request: T } | null {
  const onCurrent = (r: T) => (r.promotionEventId === null ? r.expectedCurrentRungId === currentStripeId : r.toRungId === currentStripeId);
  const blocked = requests.find(isPromotionBlocked);
  if (blocked) return { status: 'blocked', request: blocked };
  const waiting = requests.find((r) => isWaitingForFee(r) && onCurrent(r));
  if (waiting) return { status: 'waiting', request: waiting };
  const toDecide = requests.find((r) => isOpenToDecide(r) && r.expectedCurrentRungId === currentStripeId);
  if (toDecide) return { status: 'toDecide', request: toDecide };
  const declined = requests.find((r) => r.status === 'DECLINED' && onCurrent(r));
  if (declined) return { status: 'declined', request: declined };
  return null;
}

/** "25.00 GBP"-style text for a notification, from minor units. */
export function formatFee(amountMinor: number, currency: string | null): string {
  if (!currency) return (amountMinor / 100).toFixed(2);
  try {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amountMinor / 10 ** digits);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}
