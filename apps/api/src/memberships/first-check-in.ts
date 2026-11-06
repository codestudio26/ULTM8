import type { Prisma } from '@prisma/client';
import { passExpiryDate, schoolZoneFor } from './pass-expiry';

/**
 * Decision 316 item 4, as answered by Decision 435 item 7: a Class Pack,
 * Weekly Pass or Trial on a plan that "starts on first check-in" has no end
 * date until then. The first check-in to a class it paid for (the booking's
 * funding membership) starts its days: from the class's start, or the moment
 * of the check-in if that is earlier (checking in before the class starts), so
 * attendance staff log for a past class (Decision 317 item 4) starts it on the
 * day of that class. Its end is then worked out as for any N-day pass, in the
 * School's time zone (Decision 432 item 8). Only once: the update needs the
 * membership to be still waiting.
 */
export async function startOnFirstCheckIn(
  tx: Pick<Prisma.TransactionClient, 'booking' | 'membership' | 'school'>,
  bookingId: string,
  now: Date = new Date(),
): Promise<void> {
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, select: { sourceMembershipId: true, class: { select: { startDate: true } } } });
  if (!booking?.sourceMembershipId) return;
  const membership = await tx.membership.findUnique({
    where: { id: booking.sourceMembershipId },
    select: { id: true, schoolId: true, awaitingFirstCheckIn: true, membershipPlan: { select: { expiryDurationDays: true } } },
  });
  if (!membership?.awaitingFirstCheckIn) return;
  const startAt = booking.class.startDate < now ? booking.class.startDate : now;
  const zone = await schoolZoneFor(tx, membership.schoolId);
  await tx.membership.updateMany({
    where: { id: membership.id, awaitingFirstCheckIn: true },
    data: { awaitingFirstCheckIn: false, startDate: startAt, expiryDate: passExpiryDate(membership.membershipPlan.expiryDurationDays, zone, startAt) ?? null },
  });
}
