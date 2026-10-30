import { addDays, firstIndexOnOrAfter, nextDay, occurrenceDay, planOccurrences, schoolToday, skipThrough, type SeriesState } from './recurring-schedule';

const series = (over: Partial<SeriesState>): SeriesState => ({
  firstDate: '2027-01-31',
  frequency: 'MONTHLY',
  endDate: null,
  maxOccurrences: null,
  nextIndex: 0,
  createdCount: 0,
  ...over,
});

describe('recurring charge calendar (Decision 412)', () => {
  describe('occurrenceDay', () => {
    it('weekly: the same weekday, 7 days apart, across a month and a year end', () => {
      expect([0, 1, 2, 3].map((i) => occurrenceDay('2027-12-17', 'WEEKLY', i))).toEqual(['2027-12-17', '2027-12-24', '2027-12-31', '2028-01-07']);
      const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
      for (let i = 0; i < 60; i++) expect(weekday(occurrenceDay('2027-03-03', 'WEEKLY', i))).toBe(weekday('2027-03-03'));
    });

    it('monthly on the 31st: the last day of shorter months, back to the 31st after', () => {
      expect([0, 1, 2, 3, 4].map((i) => occurrenceDay('2027-01-31', 'MONTHLY', i))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
    });

    it('monthly on the 29th and 30th: February in a leap year and not', () => {
      expect(occurrenceDay('2027-01-29', 'MONTHLY', 1)).toBe('2027-02-28');
      expect(occurrenceDay('2028-01-29', 'MONTHLY', 1)).toBe('2028-02-29');
      expect(occurrenceDay('2028-01-30', 'MONTHLY', 1)).toBe('2028-02-29');
      expect(occurrenceDay('2027-01-30', 'MONTHLY', 2)).toBe('2027-03-30');
    });

    it('monthly across a year end', () => {
      expect(occurrenceDay('2027-11-15', 'MONTHLY', 2)).toBe('2028-01-15');
      expect(occurrenceDay('2027-11-15', 'MONTHLY', 14)).toBe('2029-01-15');
    });

    it('yearly: the same date; 29 Feb is 28 Feb in a year that is not a leap year', () => {
      expect([0, 1, 2, 3, 4].map((i) => occurrenceDay('2028-02-29', 'YEARLY', i))).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
      expect(occurrenceDay('2027-06-10', 'YEARLY', 3)).toBe('2030-06-10');
    });

    it('rejects a bad index or day', () => {
      expect(() => occurrenceDay('2027-01-01', 'WEEKLY', -1)).toThrow();
      expect(() => occurrenceDay('27-1-1', 'WEEKLY', 0)).toThrow();
    });
  });

  describe('planOccurrences', () => {
    it('makes the occurrence on its day, not ahead', () => {
      const s = series({ firstDate: '2027-03-10' });
      expect(planOccurrences(s, '2027-03-09')).toEqual({ due: [], nextIndex: 0, nextDay: '2027-03-10' });
      expect(planOccurrences(s, '2027-03-10')).toEqual({ due: [{ index: 0, day: '2027-03-10' }], nextIndex: 1, nextDay: '2027-04-10' });
    });

    it('catches up one per missed occurrence after days without a run, never more', () => {
      const s = series({ firstDate: '2027-03-01', frequency: 'WEEKLY', nextIndex: 1, createdCount: 1 });
      const plan = planOccurrences(s, '2027-03-25');
      expect(plan.due.map((o) => o.day)).toEqual(['2027-03-08', '2027-03-15', '2027-03-22']);
      expect(plan.nextIndex).toBe(4);
      expect(plan.nextDay).toBe('2027-03-29');
      // Running again on the same day finds nothing more to make.
      expect(planOccurrences({ ...s, nextIndex: plan.nextIndex, createdCount: 4 }, '2027-03-25').due).toEqual([]);
    });

    it('stops after the number of payments', () => {
      const s = series({ firstDate: '2027-01-15', maxOccurrences: 3 });
      const plan = planOccurrences(s, '2027-12-31');
      expect(plan.due.map((o) => o.day)).toEqual(['2027-01-15', '2027-02-15', '2027-03-15']);
      expect(plan.nextDay).toBeNull();
      expect(nextDay({ ...s, nextIndex: 3, createdCount: 3 })).toBeNull();
    });

    it('a number of payments counts charges made, not occurrences skipped', () => {
      // Two occurrences were skipped (nextIndex 4, only 2 made): two more to go.
      const s = series({ firstDate: '2027-01-15', maxOccurrences: 4, nextIndex: 4, createdCount: 2 });
      expect(planOccurrences(s, '2027-12-31').due.map((o) => o.day)).toEqual(['2027-05-15', '2027-06-15']);
    });

    it('stops after the end date, which may be an occurrence day itself', () => {
      const s = series({ firstDate: '2027-01-05', frequency: 'WEEKLY', endDate: '2027-01-19' });
      const plan = planOccurrences(s, '2027-02-28');
      expect(plan.due.map((o) => o.day)).toEqual(['2027-01-05', '2027-01-12', '2027-01-19']);
      expect(plan.nextDay).toBeNull();
      expect(nextDay(series({ firstDate: '2027-01-05', frequency: 'WEEKLY', endDate: '2027-01-18', nextIndex: 2, createdCount: 2 }))).toBeNull();
    });

    it('caps one run', () => {
      const s = series({ firstDate: '2027-01-01', frequency: 'WEEKLY' });
      const plan = planOccurrences(s, '2037-01-01', 10);
      expect(plan.due).toHaveLength(10);
      expect(plan.nextIndex).toBe(10);
      expect(plan.nextDay).toBe(occurrenceDay('2027-01-01', 'WEEKLY', 10));
    });
  });

  describe('firstIndexOnOrAfter (restarting)', () => {
    it('picks the first occurrence on or after the day, skipping those missed while stopped', () => {
      expect(firstIndexOnOrAfter('2027-01-31', 'MONTHLY', '2027-03-01')).toBe(2);
      expect(firstIndexOnOrAfter('2027-01-31', 'MONTHLY', '2027-02-28')).toBe(1);
      expect(firstIndexOnOrAfter('2027-01-31', 'MONTHLY', '2027-03-31')).toBe(2);
      expect(firstIndexOnOrAfter('2027-01-04', 'WEEKLY', '2027-01-19')).toBe(3);
      expect(firstIndexOnOrAfter('2028-02-29', 'YEARLY', '2029-03-01')).toBe(2);
      expect(firstIndexOnOrAfter('2028-02-29', 'YEARLY', '2029-02-28')).toBe(1);
    });

    it('never goes back before an occurrence already made', () => {
      expect(firstIndexOnOrAfter('2027-01-31', 'MONTHLY', '2027-01-01', 3)).toBe(3);
      expect(firstIndexOnOrAfter('2027-01-31', 'MONTHLY', '2027-02-28', 3)).toBe(3);
    });

    it('agrees with occurrenceDay for every day of two years', () => {
      for (const frequency of ['WEEKLY', 'MONTHLY', 'YEARLY'] as const) {
        for (let t = Date.UTC(2027, 0, 1); t < Date.UTC(2029, 0, 1); t += 24 * 60 * 60 * 1000) {
          const day = new Date(t).toISOString().slice(0, 10);
          const i = firstIndexOnOrAfter('2027-01-31', frequency, day);
          expect(occurrenceDay('2027-01-31', frequency, i) >= day).toBe(true);
          if (i > 0) expect(occurrenceDay('2027-01-31', frequency, i - 1) < day).toBe(true);
        }
      }
    });
  });

  describe('skipThrough (a closed or degraded School)', () => {
    it('moves past every occurrence up to today without counting them as payments', () => {
      const s = series({ firstDate: '2027-01-04', frequency: 'WEEKLY', maxOccurrences: 3, nextIndex: 1, createdCount: 1 });
      expect(skipThrough(s, '2027-01-25')).toEqual({ nextIndex: 4, nextDay: '2027-02-01' });
      expect(skipThrough(s, '2027-01-24')).toEqual({ nextIndex: 3, nextDay: '2027-01-25' });
    });
    it('ends the series when the end date passes meanwhile', () => {
      expect(skipThrough(series({ firstDate: '2027-01-31', endDate: '2027-03-31' }), '2027-03-31')).toEqual({ nextIndex: 3, nextDay: null });
    });
    it('addDays crosses month and leap-year ends', () => {
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
      expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    });
  });

  describe('schoolToday (the School time zone)', () => {
    const instant = new Date('2027-03-10T05:30:00Z');
    it('is the day in the School time zone', () => {
      expect(schoolToday(instant, 'UTC')).toBe('2027-03-10');
      expect(schoolToday(instant, 'America/Los_Angeles')).toBe('2027-03-09');
      expect(schoolToday(instant, 'Pacific/Auckland')).toBe('2027-03-10');
      expect(schoolToday(new Date('2027-03-10T11:30:00Z'), 'Pacific/Auckland')).toBe('2027-03-11');
    });
    it('falls back to UTC for no or an unknown zone', () => {
      expect(schoolToday(instant, null)).toBe('2027-03-10');
      expect(schoolToday(instant, 'Not/AZone')).toBe('2027-03-10');
    });
  });
});
