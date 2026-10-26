import { ConflictException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Shared by a Class's own capacity edit and a TimetableSlot capacity edit that
 * reaches its generated Classes. Run inside the caller's tenant transaction.
 *
 * - Capacity can't drop below the seats already taken (product owner, 26 Oct
 *   2026). The row lock is the same one booking takes, so no booking slips in
 *   meanwhile.
 * - Returns how many seats to offer the waitlist: with Students queued, nobody
 *   can book freed seats directly (waitlist first), so they're offered at once.
 *   `null` (unlimited) offers a seat to everyone still waiting (C6: before, an
 *   unlimited Class left its waitlist stuck while others booked past it).
 */
export async function applyCapacityChange(tx: Tx, classId: string, capacity: number | null): Promise<number> {
  await tx.$queryRaw`SELECT id FROM "Class" WHERE id = ${classId} FOR UPDATE`;
  const [waiting, notified] = await Promise.all([
    tx.waitlistEntry.count({ where: { classId, status: 'WAITING' } }),
    tx.waitlistEntry.count({ where: { classId, status: 'NOTIFIED' } }),
  ]);
  if (capacity === null) {
    return waiting;
  }
  const [bookings, guests] = await Promise.all([
    tx.booking.count({ where: { classId, status: 'UPCOMING' } }),
    tx.bookingAttendee.count({ where: { booking: { classId, status: 'UPCOMING' } } }),
  ]);
  const taken = bookings + guests;
  if (capacity < taken) {
    throw new ConflictException({
      code: 'CAPACITY_BELOW_BOOKED',
      message: `${taken} ${taken === 1 ? 'student is' : 'students are'} booked. Cancel some bookings first, or set the capacity to ${taken} or more.`,
    });
  }
  return Math.max(0, Math.min(waiting, capacity - taken - notified));
}

/** Offers `count` freed seats to the waitlist, after the capacity change commits. */
export async function offerSeatsToWaitlist(queue: Queue, classId: string, count: number, logger: Logger): Promise<void> {
  for (let i = 0; i < count; i++) {
    try {
      await queue.add('seat-freed', { classId });
    } catch (err) {
      logger.warn(`Failed to enqueue waitlist-cascade-processing after changing Class ${classId}'s capacity: ${err}`);
    }
  }
}
