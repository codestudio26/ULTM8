import { DateTime } from 'luxon';
import { TimetableSlot } from '@prisma/client';
import { buildSlotOccurrences, endsNextDay, minutesBetween, occurrenceFields } from './slot-occurrences';
import { assertValidTimes } from './timetable.service';

const t = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

function slot(start: string, end: string, extra: Partial<TimetableSlot> = {}): TimetableSlot {
  return {
    id: 'slot-1',
    schoolId: 'school-1',
    branchId: null,
    instructorId: null,
    weekday: 'SUNDAY',
    startTime: t(start),
    endTime: t(end),
    breakStart: null,
    breakEnd: null,
    status: 'ON',
    title: 'Open mat',
    activities: [],
    styles: [],
    capacity: null,
    description: null,
    bannerUrl: null,
    termsWaiverRequired: false,
    membershipInclusion: false,
    bookingCutoffMinutesBeforeStart: null,
    qrAttendanceWindowMinutes: null,
    refundCutoffHoursBeforeStart: null,
    cancellationCharge: null,
    ...extra,
  } as TimetableSlot;
}

const on = (date: string, zone: string) => DateTime.fromISO(date, { zone }).startOf('day');
const minutes = (f: { startDate: Date; endDate: Date }) => (f.endDate.getTime() - f.startDate.getTime()) / 60_000;
const local = (d: Date, zone: string) => DateTime.fromJSDate(d).setZone(zone).toFormat('yyyy-LL-dd HH:mm');

describe('occurrenceFields on DST nights (Decision 432 item 4)', () => {
  it('Sydney spring forward: a 02:30–03:30 class is not 0 minutes long', () => {
    const f = occurrenceFields(slot('02:30', '03:30'), on('2027-10-03', 'Australia/Sydney'));
    expect(minutes(f)).toBe(60);
    expect(local(f.startDate, 'Australia/Sydney')).toBe('2027-10-03 03:30');
  });

  it('Sydney fall back: the printed clock times are kept (03:30 is still the end)', () => {
    const f = occurrenceFields(slot('02:30', '03:30'), on('2027-04-04', 'Australia/Sydney'));
    expect(local(f.endDate, 'Australia/Sydney')).toBe('2027-04-04 03:30');
    expect(minutes(f)).toBe(120);
  });

  it('Lord Howe spring forward: a 02:00–02:30 class takes its normal length', () => {
    const f = occurrenceFields(slot('02:00', '02:30'), on('2027-10-03', 'Australia/Lord_Howe'));
    expect(minutes(f)).toBe(30);
    expect(f.endDate.getTime()).toBeGreaterThan(f.startDate.getTime());
  });

  it('New York spring forward: a 02:00–03:00 class is never 0 minutes', () => {
    const f = occurrenceFields(slot('02:00', '03:00'), on('2027-03-14', 'America/New_York'));
    expect(minutes(f)).toBeGreaterThan(0);
  });

  it('an ordinary day is unchanged', () => {
    const f = occurrenceFields(slot('18:00', '19:30'), on('2027-06-06', 'America/New_York'));
    expect(local(f.startDate, 'America/New_York')).toBe('2027-06-06 18:00');
    expect(local(f.endDate, 'America/New_York')).toBe('2027-06-06 19:30');
  });

  it('a break that the clock skips is not backwards', () => {
    const f = occurrenceFields(slot('01:00', '04:00', { breakStart: t('02:15'), breakEnd: t('02:45') }), on('2027-10-03', 'Australia/Sydney'));
    expect(f.breakEndAt!.getTime()).toBeGreaterThan(f.breakStartAt!.getTime());
  });
});

describe('a weekly class past midnight (Decision 432 item 3)', () => {
  it('23:00–00:30 ends the next day and belongs to its start date', () => {
    const f = occurrenceFields(slot('23:00', '00:30'), on('2027-03-05', 'Asia/Dubai'));
    expect(local(f.startDate, 'Asia/Dubai')).toBe('2027-03-05 23:00');
    expect(local(f.endDate, 'Asia/Dubai')).toBe('2027-03-06 00:30');
    expect(minutes(f)).toBe(90);
    expect(f.occurrenceDate.toISOString().slice(0, 10)).toBe('2027-03-05');
  });

  it('a break after midnight lands on the next day', () => {
    const f = occurrenceFields(slot('22:00', '01:00', { breakStart: t('23:45'), breakEnd: t('00:15') }), on('2027-03-05', 'Asia/Dubai'));
    expect(local(f.breakStartAt!, 'Asia/Dubai')).toBe('2027-03-05 23:45');
    expect(local(f.breakEndAt!, 'Asia/Dubai')).toBe('2027-03-06 00:15');
  });

  it('the generator makes 4 weeks of overnight classes', () => {
    const rows = buildSlotOccurrences(slot('23:00', '00:30', { weekday: 'FRIDAY' }), 'America/Sao_Paulo', new Date('2027-03-01T12:00:00Z'));
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(((r.endDate as Date).getTime() - (r.startDate as Date).getTime()) / 60_000).toBe(90);
  });

  it('endsNextDay and minutesBetween', () => {
    expect(endsNextDay(t('23:00'), t('00:30'))).toBe(true);
    expect(endsNextDay(t('18:00'), t('19:00'))).toBe(false);
    expect(minutesBetween(23 * 60, 30)).toBe(90);
    expect(minutesBetween(600, 600)).toBe(0);
  });
});

describe('assertValidTimes (Decision 332 T8 as amended by Decision 432 item 3)', () => {
  it('accepts a class that ends after midnight', () => {
    expect(() => assertValidTimes('23:00', '00:30', null, null)).not.toThrow();
    expect(() => assertValidTimes('22:00', '00:30', '23:30', '23:45')).not.toThrow();
    expect(() => assertValidTimes('22:00', '01:00', '23:50', '00:10')).not.toThrow();
  });

  it('refuses an end equal to the start, or more than 12 hours', () => {
    expect(() => assertValidTimes('18:00', '18:00', null, null)).toThrow(/same as the start/);
    expect(() => assertValidTimes('08:00', '20:01', null, null)).toThrow(/12 hours/);
    expect(() => assertValidTimes('19:00', '18:00', null, null)).toThrow(/12 hours/);
    expect(() => assertValidTimes('08:00', '20:00', null, null)).not.toThrow();
  });

  it('keeps the break rules', () => {
    expect(() => assertValidTimes('18:00', '20:00', '17:00', '18:30')).toThrow(/inside/);
    expect(() => assertValidTimes('18:00', '20:00', '19:00', '18:30')).toThrow(/end after it starts/);
    expect(() => assertValidTimes('23:00', '00:30', '00:40', '00:50')).toThrow(/inside/);
    expect(() => assertValidTimes('18:00', '20:00', '19:00', null)).toThrow(/both/);
  });
});
