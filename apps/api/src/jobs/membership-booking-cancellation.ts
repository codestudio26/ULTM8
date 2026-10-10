import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Decision 122 — Spec 55 §6.1's own confirmed "same-day sweep cancels the
 * Student's own future Bookings" half of the Membership-expiry rule. Shared
 * between every place in this codebase that force-Expires a Membership: a
 * Subscription's final cancellation and a lost Membership-purchase dispute
 * (both in stripe-webhook-processing.processor.ts), and the date-based
 * expiryDate-passing sweep (membership-expiry-sweep.processor.ts) — three
 * sites, one shared helper, so the WITHHELD-not-REFUNDED/scope reasoning below
 * only has to be reconciled once as this rule evolves.
 *
 * Scope, inferred and flagged for Architect review (not itself a new
 * SKILL.md-confirmed rule — it's this same already-confirmed Spec 55 §6.1
 * sentence): only the Student's OWN seat (Booking.sourceMembershipId) is
 * cancelled here. A BookingAttendee guest seat this Membership was funding for
 * a DIFFERENT Student is deliberately left untouched — whether losing your own
 * Membership should also bump a guest you invited off someone else's Booking is
 * a materially different, undecided question this fix doesn't attempt to
 * answer.
 *
 * refundResolution is WITHHELD, never REFUNDED: this is a forced cancellation
 * because the funding Membership itself is gone (a failed renewal, a lost
 * dispute, or simply running past its own expiry date), not the Student's own
 * voluntary cancellation under the Class's own refund policy — there is no
 * credit to hand back to a Membership that's being retired for good.
 * restoreCredit() is deliberately NOT called for the same reason (and would be
 * a no-op for a general-access Membership regardless — see that method's own
 * comment).
 *
 * Callers are expected to run this inside the SAME transaction as the
 * Membership-status write that triggered it — this is a plain DB write with no
 * external call, so it belongs in the transaction, not deferred to a
 * post-commit block. Only the resulting waitlist-cascade 'seat-freed' enqueue
 * is deferred by each caller (BullMQ/Redis doesn't participate in the Postgres
 * transaction).
 */
export async function cancelFutureBookingsFundedByExpiredMembership(
  tx: Prisma.TransactionClient,
  membershipId: string,
  logger: Logger,
): Promise<string[]> {
  const affected = await tx.booking.findMany({
    where: { sourceMembershipId: membershipId, status: 'UPCOMING' },
    select: { id: true, classId: true },
  });
  if (affected.length === 0) {
    return [];
  }
  // Optimistic-concurrency guard, same shape as every other status-transition
  // in this codebase — re-filters on status: 'UPCOMING' at write time so a
  // Booking that left UPCOMING between the read above and this write (e.g. the
  // Student cancelled it themselves, or it was just marked No-Show) is left
  // alone rather than double-resolved.
  await tx.booking.updateMany({
    where: { id: { in: affected.map((b) => b.id) }, status: 'UPCOMING' },
    data: { status: 'CANCELLED', refundResolution: 'WITHHELD' },
  });
  logger.log(`Membership ${membershipId} Expired — cancelled ${affected.length} future Booking(s) it was funding.`);
  return affected.map((b) => b.classId);
}
