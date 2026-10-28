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
 *
 * A one-off Class (not made by the Timetable) needs its own ticket, a Membership
 * scoped to that Class, unless the School ticked "Included in membership" on it
 * (SKILL.md §6, Classes review C1, Decision 345). Timetable Classes are always
 * covered by general access, whatever the flag says.
 *
 * A Friend Pass never pays for its holder's own seat: it only covers a guest
 * (product owner, 28 Oct 2026; guests go through consumeGuestMembership). A
 * Student whose only plan is a Friend Pass gets the usual "no Active
 * Membership" refusal.
 */
export async function selectAndConsumeMembership(
  tx: TenantTx,
  studentId: string,
  schoolId: string,
  cls: OneOffMarkers,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const classId = cls.id;
  const ticketOnly = needsOwnTicket(cls);
  const candidates = await tx.membership.findMany({
    where: {
      studentId,
      schoolId,
      status: 'ACTIVE',
      membershipPlan: { type: { not: 'FRIEND_PASS' } },
      AND: [
        ticketOnly ? { scopedClassId: classId } : { OR: [{ scopedClassId: null }, { scopedClassId: classId }] },
        { OR: [{ expiryDate: null }, { expiryDate: { gt: now } }] },
      ],
    },
    orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  });
  if (ticketOnly && candidates.length === 0) {
    throw new BadRequestException({
      code: 'TICKET_REQUIRED',
      message: 'This one-off class needs its own ticket. A Subscription, Weekly Pass or general Class Pack does not cover it.',
    });
  }

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

/** The Class fields that tell a one-off Class from a Timetable one. */
export type OneOffMarkers = { id: string; timetableSlotId: string | null; occurrenceDate: Date | null; membershipInclusion: boolean };

/** Whether only a ticket for this Class (a Membership scoped to it) can pay for a
 * seat. A Timetable Class keeps its occurrenceDate even if its slot is later
 * deleted (timetableSlotId is SET NULL then), so both are checked. */
export function needsOwnTicket(cls: OneOffMarkers): boolean {
  return cls.timetableSlotId === null && cls.occurrenceDate === null && !cls.membershipInclusion;
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
export async function lockClassSeats(tx: TenantTx, classId: string): Promise<LockedClass> {
  return lockOpenClass(tx, classId, 'seats');
}

/**
 * The lock an uncapped Class's booking takes instead of lockClassSeats: a shared
 * one, so its bookers don't queue behind each other, but which still makes a
 * whole-class cancel (CancellationService.cancelClass) wait for them and them
 * wait for it. Same NOWAIT-and-retry shape as lockClassSeats.
 */
export async function lockClassShared(tx: TenantTx, classId: string): Promise<LockedClass> {
  return lockOpenClass(tx, classId, 'shared');
}

/** The Class as it stands under the lock: its Branch now (a Branch close may
 * have moved it since the caller read it), or null when the row isn't visible. */
export type LockedClass = { branchId: string | null } | null;

/**
 * Locks the Class row and re-reads it under the lock. Found by the stress test of
 * 27 Oct 2026: the cancelled/archived check ran on a read taken before the
 * transaction, so a Class the School cancelled meanwhile still took Bookings that
 * the cancel's own sweep never saw (5 to 10 of 10 left UPCOMING). The re-read is
 * the row's latest committed version, so a cancel either finished first (refused
 * here) or waits for this booking and then cancels it with the rest. The same goes
 * for the Class's Branch: a Booking or waitlist place copies it, and a Branch close
 * that moved the Class meanwhile left new Bookings at the closed Branch.
 *
 * A row the caller's context can't see (none of the paths using this expect that)
 * takes no lock and is left to the checks the caller already made.
 */
async function lockOpenClass(tx: TenantTx, classId: string, mode: 'seats' | 'shared'): Promise<LockedClass> {
  let rows: Array<{ cancelledAt: Date | null; archivedAt: Date | null; branchId: string | null }>;
  try {
    rows = mode === 'seats'
      ? await tx.$queryRaw`SELECT "cancelledAt", "archivedAt", "branchId" FROM "Class" WHERE id = ${classId} FOR UPDATE NOWAIT`
      : await tx.$queryRaw`SELECT "cancelledAt", "archivedAt", "branchId" FROM "Class" WHERE id = ${classId} FOR SHARE NOWAIT`;
  } catch (err) {
    if (isLockNotAvailable(err)) throw new SeatLockBusyError();
    throw err;
  }
  const cls = rows[0];
  if (cls?.cancelledAt) {
    throw new ConflictException('This class has been cancelled by the school.');
  }
  if (cls?.archivedAt) {
    throw new BadRequestException('This Class is archived and can no longer be booked.');
  }
  return cls ? { branchId: cls.branchId } : null;
}

/**
 * Serializes everything that creates or checks in one Student's Booking for one
 * Class, until the transaction ends. Found by the stress test of 27 Oct 2026 (two
 * front desks booking and checking in the same Student at once, 2 of 32 bookings
 * HTTP 500): a booking held the Class's seat lock and waited, at the "one Upcoming
 * Booking per Student per Class" unique index, for a check-in of the same
 * Student's earlier Booking; that check-in's training log needed a key-share lock
 * on the same Class row, so Postgres found a deadlock (40P01). Taken first, before
 * any row lock, by bookings, waitlist claims and check-ins, so the second of two
 * such requests waits here holding nothing, and a duplicate booking is refused
 * with the usual 409.
 */
export async function lockStudentClass(tx: Pick<TenantTx, '$executeRaw'>, studentId: string, classId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${studentId}:${classId}`}, 0))`;
}

/**
 * A Student attends a Class once (product owner, 28 Oct 2026): once checked in
 * (Booking COMPLETED), a second Booking or waitlist place for the same Class is
 * refused. A cancelled Booking doesn't count. The unique index only covers
 * UPCOMING Bookings, so this runs after lockStudentClass, which also holds
 * every check-in of this Student into this Class: two desks can't both pass it.
 */
export async function assertNotAlreadyAttended(tx: Pick<TenantTx, 'booking'>, studentId: string, classId: string): Promise<void> {
  const attended = await tx.booking.findFirst({ where: { studentId, classId, status: 'COMPLETED' }, select: { id: true } });
  if (attended) {
    throw new ConflictException({ code: 'ALREADY_ATTENDED', message: 'This student has already attended this class.' });
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
