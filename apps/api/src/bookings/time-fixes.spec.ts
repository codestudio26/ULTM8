import { DateTime } from 'luxon';
import { defaultWeekRange, weekStartOf } from './booking-week';
import { effectiveRefundCutoff } from './leaving-student-cancellation';
import { passExpiryDate } from '../memberships/pass-expiry';

describe("defaultWeekRange follows the School's week start (Decision 431 item 7)", () => {
  // Wednesday 4 Nov 2026, 15:00 in São Paulo.
  const wed = new Date('2026-11-04T18:00:00Z');

  it('a Sunday-start School gets Sunday to Saturday', () => {
    expect(defaultWeekRange('America/Sao_Paulo', 'SUNDAY', wed)).toEqual({ from: '2026-11-01', to: '2026-11-07' });
  });

  it('a Monday-start School (and the default) gets Monday to Sunday', () => {
    expect(defaultWeekRange('America/Sao_Paulo', 'MONDAY', wed)).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(defaultWeekRange('America/Sao_Paulo', undefined, wed)).toEqual({ from: '2026-11-02', to: '2026-11-08' });
  });

  it('on a Sunday, a Sunday-start week starts today', () => {
    const sun = new Date('2026-11-08T15:00:00Z');
    expect(defaultWeekRange('America/Sao_Paulo', 'SUNDAY', sun)).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    expect(defaultWeekRange('America/Sao_Paulo', 'MONDAY', sun)).toEqual({ from: '2026-11-02', to: '2026-11-08' });
  });

  it('weekStartOf keeps its existing answers', () => {
    expect(weekStartOf('2026-11-04', 'MONDAY')).toBe('2026-11-02');
    expect(weekStartOf('2026-11-04', 'SUNDAY')).toBe('2026-11-01');
  });
});

describe('passExpiryDate counts calendar days in the School zone (Decision 431 item 8)', () => {
  it('a 7-day pass bought before a DST change ends at the same wall-clock time', () => {
    // Bought Wednesday 10 Mar 2027 10:00 in New York; clocks go forward on 14 Mar.
    const bought = DateTime.fromISO('2027-03-10T10:00', { zone: 'America/New_York' }).toJSDate();
    const ends = passExpiryDate(7, 'America/New_York', bought)!;
    expect(DateTime.fromJSDate(ends).setZone('America/New_York').toFormat('yyyy-LL-dd HH:mm')).toBe('2027-03-17 10:00');
    expect((ends.getTime() - bought.getTime()) / 3_600_000).toBe(167);
  });

  it('no length means no expiry; an unknown zone counts in UTC', () => {
    expect(passExpiryDate(null, 'Europe/London')).toBeUndefined();
    const now = new Date('2027-01-01T00:00:00Z');
    expect(passExpiryDate(1, 'Mountain Standard Time', now)!.toISOString()).toBe('2027-01-02T00:00:00.000Z');
  });
});

describe('effectiveRefundCutoff (Decision 431 item 9)', () => {
  const start = new Date('2027-01-10T18:00:00Z');
  it("uses the class's own cut-off first", () => {
    const own = new Date('2027-01-10T10:00:00Z');
    expect(effectiveRefundCutoff({ refundFeeDate: own, startDate: start }, 24)).toBe(own);
  });
  it('else the default hours before the start', () => {
    expect(effectiveRefundCutoff({ refundFeeDate: null, startDate: start }, 24)!.toISOString()).toBe('2027-01-09T18:00:00.000Z');
  });
  it('else none', () => {
    expect(effectiveRefundCutoff({ refundFeeDate: null, startDate: start }, null)).toBeNull();
  });
});
