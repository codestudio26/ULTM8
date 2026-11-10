import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * GET /bookings/me's order (Decision 450 item 2, a demo finding: the member app's "My
 * Bookings" was in id order, i.e. random). The screen is one list, so it reads
 * in three parts, each with a stable keyset:
 *
 * 1. "up": classes that haven't ended yet (end after the list's moment, the
 *    same "upcoming" test as a Guardian's view of a child's bookings,
 *    findMinorUpcomingBookings), soonest start first, a class in progress at
 *    the top;
 * 2. "past": classes that have ended, newest start first;
 * 3. "gone": bookings whose class this member can no longer read (it then
 *    shows without a name or time, Decision 427 SP4), oldest booking first.
 *
 * Ties on the start time break on the booking id. The cursor carries the part,
 * the moment page one was read (`at`, so a class ending while the member pages
 * doesn't move between parts or show twice), the last start time and id.
 */
export type MyBookingsPart = 'up' | 'past' | 'gone';

export interface MyBookingsCursor {
  part: MyBookingsPart;
  at: Date;
  start: Date | null;
  id: string;
}

export const MY_BOOKINGS_PARTS: MyBookingsPart[] = ['up', 'past', 'gone'];

export function encodeMyBookingsCursor(c: MyBookingsCursor): string {
  return Buffer.from(JSON.stringify({ p: c.part, at: c.at.toISOString(), s: c.start?.toISOString() ?? null, id: c.id })).toString('base64url');
}

/** An older id-only cursor (before this order) or anything else unreadable is
 * refused, never silently restarted (that would repeat bookings). */
export function decodeMyBookingsCursor(cursor: string): MyBookingsCursor {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { p?: unknown; at?: unknown; s?: unknown; id?: unknown };
    const part = raw.p as MyBookingsPart;
    if (!MY_BOOKINGS_PARTS.includes(part) || typeof raw.at !== 'string' || typeof raw.id !== 'string' || !raw.id) throw new Error('shape');
    const at = new Date(raw.at);
    const start = typeof raw.s === 'string' ? new Date(raw.s) : null;
    if (Number.isNaN(at.getTime()) || (part !== 'gone' && (!start || Number.isNaN(start.getTime())))) throw new Error('dates');
    return { part, at, start, id: raw.id };
  } catch {
    throw new BadRequestException('cursor is not valid');
  }
}

/** The where and order of one part, after `after` when it is in this part. */
export function myBookingsPartQuery(
  part: MyBookingsPart,
  at: Date,
  after: MyBookingsCursor | null,
): { where: Prisma.BookingWhereInput; orderBy: Prisma.BookingOrderByWithRelationInput[] } {
  const from = after?.part === part ? after : null;
  if (part === 'up') {
    return {
      where: {
        class: { endDate: { gt: at } },
        ...(from ? { OR: [{ class: { startDate: { gt: from.start! } } }, { class: { startDate: from.start! }, id: { gt: from.id } }] } : {}),
      },
      orderBy: [{ class: { startDate: 'asc' } }, { id: 'asc' }],
    };
  }
  if (part === 'past') {
    return {
      where: {
        class: { endDate: { lte: at } },
        ...(from ? { OR: [{ class: { startDate: { lt: from.start! } } }, { class: { startDate: from.start! }, id: { lt: from.id } }] } : {}),
      },
      orderBy: [{ class: { startDate: 'desc' } }, { id: 'desc' }],
    };
  }
  // A class this member can't read matches neither part above (the relation
  // filter runs under the same RLS), so it is exactly "neither".
  return {
    where: {
      NOT: [{ class: { endDate: { gt: at } } }, { class: { endDate: { lte: at } } }],
      ...(from ? { id: { gt: from.id } } : {}),
    },
    orderBy: [{ id: 'asc' }],
  };
}
