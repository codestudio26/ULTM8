import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Same shape PrismaAppService#withTenantContext hands its callback.
type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Whether a Class can take a new Booking right now. Shared by booking, waitlist
 * join and waitlist claim. Found by the booking/schedule stress test (26 Oct 2026):
 * none of the three checked the Class itself, so a Student could book a Class that
 * ended yesterday, an archived Class, or one whose booking cut-off had passed.
 *
 * - Archived or ended Classes take no Booking from anyone.
 * - The booking cut-off (`bookingEndAt`, from the timetable's
 *   bookingCutoffMinutesBeforeStart) stops Students and Guardians. Staff may still
 *   book a walk-in until the Class ends (product owner, 26 Oct 2026).
 */
export function assertClassBookable(
  cls: { archivedAt: Date | null; endDate: Date; bookingEndAt: Date | null },
  opts: { byStaff: boolean; now?: Date },
): void {
  const now = opts.now ?? new Date();
  if (cls.archivedAt) {
    throw new BadRequestException('This Class is archived and can no longer be booked.');
  }
  if (now >= cls.endDate) {
    throw new BadRequestException('This Class has already ended.');
  }
  if (!opts.byStaff && cls.bookingEndAt && now >= cls.bookingEndAt) {
    throw new BadRequestException({ code: 'BOOKING_CLOSED', message: 'Booking for this Class has closed. Ask a member of staff if you want to join.' });
  }
}

/**
 * Picks the Student's own funding Membership for their seat and spends a credit
 * when it is a pack. A non-consuming general-access Membership (classesRemaining
 * IS NULL: Subscription/Weekly Pass) wins over a credit-consuming one, so a paid
 * credit is never spent needlessly (SKILL.md §10).
 *
 * Only Memberships in effect count: ACTIVE and not past their expiryDate. Expiry
 * is live-computed at every booking check (SKILL.md §8, Decision 26); an ACTIVE
 * row whose expiryDate passed before the sweep ran used to fund Bookings.
 *
 * When two packs exist and a concurrent booking empties the first, the next one
 * is tried instead of failing the booking.
 */
export async function selectAndConsumeMembership(
  tx: TenantTx,
  studentId: string,
  schoolId: string,
  classId: string,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const candidates = await tx.membership.findMany({
    where: {
      studentId,
      schoolId,
      status: 'ACTIVE',
      AND: [
        { OR: [{ scopedClassId: null }, { scopedClassId: classId }] },
        { OR: [{ expiryDate: null }, { expiryDate: { gt: now } }] },
      ],
    },
    orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  });

  const generalAccess = candidates.find((m) => m.classesRemaining === null);
  if (generalAccess) {
    return generalAccess;
  }

  const packs = candidates.filter((m) => m.classesRemaining !== null && m.classesRemaining > 0);
  if (packs.length === 0) {
    throw new BadRequestException('This Student has no Active Membership eligible to fund this Booking.');
  }
  for (const pack of packs) {
    const result = await tx.membership.updateMany({
      where: { id: pack.id, classesRemaining: { gt: 0 } },
      data: { classesRemaining: { decrement: 1 } },
    });
    if (result.count === 1) {
      return pack;
    }
  }
  throw new ConflictException('This Membership\'s remaining credit changed concurrently — please retry.');
}

/** Thrown inside a booking transaction when another booking holds the Class's seat lock. */
export class SeatLockBusyError extends Error {
  constructor() {
    super('Class seat lock is busy');
  }
}

/**
 * Takes the Class row lock that serializes seat counting (see bookClass), without
 * waiting for it. Found by the booking/schedule stress test (26 Oct 2026): with a
 * plain FOR UPDATE, every booking queued on a popular Class held a pooled database
 * connection while it waited, the pool ran dry, and other requests failed with
 * "Unable to start a transaction in the given time" (HTTP 500; 644 of 1,500
 * bookings in a 30-students-per-class burst). NOWAIT ends the transaction at once
 * instead; withSeatLockRetry() then retries it after a short random pause, with no
 * connection held while waiting.
 */
export async function lockClassSeats(tx: TenantTx, classId: string): Promise<void> {
  try {
    await tx.$queryRaw`SELECT id FROM "Class" WHERE id = ${classId} FOR UPDATE NOWAIT`;
  } catch (err) {
    if (isLockNotAvailable(err)) throw new SeatLockBusyError();
    throw err;
  }
}

/**
 * Options for a booking transaction. A booking burst (a popular Class opening)
 * queues far more transactions than the pool has connections; waiting for a
 * connection holds none, so these wait up to 10 s instead of Prisma's default 2 s
 * before giving up with "the server is busy".
 */
export const BOOKING_TX_OPTIONS = { maxWaitMs: 10_000 };

/** Runs a booking transaction, retrying while the Class's seat lock is busy (about 10 s at most). */
export async function withSeatLockRetry<T>(run: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof SeatLockBusyError)) throw err;
      if (Date.now() >= deadline) {
        throw new ConflictException({ code: 'CLASS_BUSY', message: 'This Class is very busy right now. Please try again in a moment.' });
      }
      const backoff = Math.min(200, 10 * 2 ** Math.min(attempt, 4));
      await new Promise((resolve) => setTimeout(resolve, backoff / 2 + Math.random() * backoff));
    }
  }
}

// Postgres lock_not_available (55P03), as Prisma surfaces it from a raw query.
function isLockNotAvailable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const meta = (err as { meta?: { code?: unknown } }).meta;
  if (meta?.code === '55P03') return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('55P03');
}
