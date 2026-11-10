import { BadRequestException } from '@nestjs/common';
import { decodeMyBookingsCursor, encodeMyBookingsCursor, myBookingsPartQuery } from './my-bookings-order';

describe("GET /bookings/me's order and cursor (Decision 450 item 2)", () => {
  const at = new Date('2026-11-10T12:00:00Z');
  const start = new Date('2026-11-12T18:00:00Z');

  it('round-trips the part, the moment page one was read, the start and the id', () => {
    for (const c of [{ part: 'up' as const, at, start, id: 'b1' }, { part: 'past' as const, at, start, id: 'b2' }, { part: 'gone' as const, at, start: null, id: 'b3' }]) {
      expect(decodeMyBookingsCursor(encodeMyBookingsCursor(c))).toEqual(c);
    }
  });

  it('keeps the first page\'s moment, so a class ending meanwhile stays in its part', () => {
    const after = decodeMyBookingsCursor(encodeMyBookingsCursor({ part: 'up', at, start, id: 'b1' }));
    expect(myBookingsPartQuery('up', after.at, after).where).toMatchObject({ class: { endDate: { gt: at } } });
    expect(myBookingsPartQuery('past', after.at, after).where).toEqual({ class: { endDate: { lte: at } } });
  });

  it('pages after the cursor only within its own part', () => {
    const after = { part: 'up' as const, at, start, id: 'b1' };
    expect(myBookingsPartQuery('up', at, after).where.OR).toEqual([{ class: { startDate: { gt: start } } }, { class: { startDate: start }, id: { gt: 'b1' } }]);
    expect(myBookingsPartQuery('up', at, after).orderBy).toEqual([{ class: { startDate: 'asc' } }, { id: 'asc' }]);
    const past = { ...after, part: 'past' as const };
    expect(myBookingsPartQuery('past', at, past).where.OR).toEqual([{ class: { startDate: { lt: start } } }, { class: { startDate: start }, id: { lt: 'b1' } }]);
    expect(myBookingsPartQuery('past', at, past).orderBy).toEqual([{ class: { startDate: 'desc' } }, { id: 'desc' }]);
    expect(myBookingsPartQuery('gone', at, { part: 'gone', at, start: null, id: 'b9' }).where).toMatchObject({ id: { gt: 'b9' } });
  });

  it.each([
    ['an old id cursor', '6f9619ff-8b86-4011-b42d-00cf4fc964ff'],
    ['garbage', 'not-a-cursor'],
    ['an unknown part', Buffer.from(JSON.stringify({ p: 'sideways', at: at.toISOString(), s: null, id: 'x' })).toString('base64url')],
    ['an upcoming cursor with no start', Buffer.from(JSON.stringify({ p: 'up', at: at.toISOString(), s: null, id: 'x' })).toString('base64url')],
    ['a bad date', Buffer.from(JSON.stringify({ p: 'past', at: 'soon', s: start.toISOString(), id: 'x' })).toString('base64url')],
  ])('refuses %s with a 400', (_label, cursor) => {
    expect(() => decodeMyBookingsCursor(cursor)).toThrow(BadRequestException);
  });
});
