import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Upcoming bookings at a School: still UPCOMING, Class not yet over. A booking
 * whose Class has ended is left to attendance and the no-show sweep. */
export function leavingStudentBookingsWhere(schoolId: string, studentId: string, now: Date): Prisma.BookingWhereInput {
  return { schoolId, studentId, status: 'UPCOMING', class: { endDate: { gt: now } } };
}

export const LIVE_WAITLIST_STATUSES = ['WAITING', 'NOTIFIED'] as const;

/**
 * Decision 343 (Students S2): a student whose enrolment is revoked gives up
 * their places at that School. Their upcoming bookings are cancelled and
 * their waitlist places removed, so the seats go to someone else.
 *
 * Each booking is cancelled under the same credit rule as a cancellation by
 * staff (BookingsService.cancelBooking): the class credit comes back before
 * the Class's refund cut-off and, once it has started, as the School's
 * late-cancel setting says. No late-cancellation fee is charged and no money
 * is refunded: the student is leaving because the School removed them.
 * Guest seats on the student's own bookings go with them, under the same
 * rule. A seat the student holds as a guest on someone else's booking is left
 * alone (same open question Decision 122 leaves).
 *
 * Runs inside the revoke's own transaction, as the School owner (Booking,
 * BookingAttendee, WaitlistEntry and Membership RLS all admit the owner).
 * Returns the Classes whose seats or waitlist offers were freed; the caller
 * enqueues the waitlist cascade for them after commit.
 */
export async function cancelPlacesOfLeavingStudent(
  tx: Prisma.TransactionClient,
  schoolId: string,
  studentId: string,
  callerId: string,
  logger: Logger,
  now: Date = new Date(),
): Promise<{ bookingsCancelled: number; waitlistRemoved: number; freedClassIds: string[] }> {
  const school = await tx.school.findUnique({ where: { id: schoolId }, select: { lateCancelRefundPolicy: true } });
  const policy = school?.lateCancelRefundPolicy ?? 'NO_REFUND_ONCE_STARTED';

  const bookings = await tx.booking.findMany({
    where: leavingStudentBookingsWhere(schoolId, studentId, now),
    include: { attendees: true, class: { select: { startDate: true, refundFeeDate: true } } },
  });
  const freed = new Set<string>();
  let bookingsCancelled = 0;
  for (const booking of bookings) {
    const pastCutoff = booking.class.refundFeeDate !== null && now >= booking.class.refundFeeDate;
    const startedNoRefund = now >= booking.class.startDate && policy === 'NO_REFUND_ONCE_STARTED';
    const resolution: 'REFUNDED' | 'WITHHELD' = pastCutoff || startedNoRefund ? 'WITHHELD' : 'REFUNDED';
    // Re-filters on UPCOMING so a booking that just left it is not resolved twice.
    const result = await tx.booking.updateMany({
      where: { id: booking.id, status: 'UPCOMING' },
      data: { status: 'CANCELLED', refundResolution: resolution, resolvedById: callerId },
    });
    if (result.count === 0) continue;
    bookingsCancelled += 1;
    freed.add(booking.classId);
    if (resolution === 'REFUNDED') await restoreCredit(tx, booking.sourceMembershipId, logger);
    for (const attendee of booking.attendees) {
      await tx.bookingAttendee.update({ where: { id: attendee.id }, data: { refundResolution: resolution, resolvedById: callerId } });
      if (resolution === 'REFUNDED') await restoreCredit(tx, attendee.membershipId, logger);
    }
  }

  const entries = await tx.waitlistEntry.findMany({
    where: { schoolId, studentId, status: { in: [...LIVE_WAITLIST_STATUSES] } },
    select: { id: true, classId: true, status: true },
  });
  let waitlistRemoved = 0;
  if (entries.length > 0) {
    const result = await tx.waitlistEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) }, status: { in: [...LIVE_WAITLIST_STATUSES] } },
      data: { status: 'CANCELLED' },
    });
    waitlistRemoved = result.count;
    // A NOTIFIED entry was holding an offered seat: offer it to the next person.
    for (const entry of entries) if (entry.status === 'NOTIFIED') freed.add(entry.classId);
  }

  if (bookingsCancelled + waitlistRemoved > 0) {
    logger.log(`Student ${studentId} left School ${schoolId}: cancelled ${bookingsCancelled} booking(s), removed ${waitlistRemoved} waitlist place(s).`);
  }
  return { bookingsCancelled, waitlistRemoved, freedClassIds: [...freed] };
}

/** Same as BookingsService.restoreCredit: a pack's credit comes back, except
 * while the payment that funded it is disputed (Decisions 55, 111). */
async function restoreCredit(tx: Prisma.TransactionClient, membershipId: string, logger: Logger): Promise<void> {
  const membership = await tx.membership.findUnique({ where: { id: membershipId }, select: { classesRemaining: true } });
  if (!membership || membership.classesRemaining === null) return;
  const disputed = await tx.transaction.findFirst({ where: { membershipId, status: 'DISPUTED' }, select: { id: true } });
  if (disputed) {
    logger.warn(`Membership ${membershipId}'s credit-restore skipped — its Transaction ${disputed.id} is under an active Stripe dispute (Decision 55/111).`);
    return;
  }
  await tx.membership.update({ where: { id: membershipId }, data: { classesRemaining: { increment: 1 } } });
}
