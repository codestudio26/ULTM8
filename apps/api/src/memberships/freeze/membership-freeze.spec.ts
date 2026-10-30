import { assertFreezeAllowed, backDay, currentFreeze, dayNumber, frozenDays, FreezeRuleError, isFrozenOn } from './membership-freeze';

/** Decision 404 — the freeze date rules, worked out live (never a stored status). */
const d = (day: string) => new Date(`${day}T00:00:00.000Z`);
const approved = (id: string, startsAt: string, endsAt: string, endedEarlyAt: Date | null = null) => ({
  id, status: 'APPROVED', startsAt: d(startsAt), endsAt: d(endsAt), endedEarlyAt, createdAt: d(startsAt),
});

describe('membership freeze dates', () => {
  it('is frozen from the first day up to, not including, the day the member is back', () => {
    const f = approved('a', '2026-11-02', '2026-11-12');
    expect(isFrozenOn(f, '2026-11-01', 'UTC')).toBe(false);
    expect(isFrozenOn(f, '2026-11-02', 'UTC')).toBe(true);
    expect(isFrozenOn(f, '2026-11-11', 'UTC')).toBe(true);
    expect(isFrozenOn(f, '2026-11-12', 'UTC')).toBe(false);
    expect(frozenDays(f, 'UTC')).toBe(10);
    expect(isFrozenOn({ ...f, status: 'REQUESTED' }, '2026-11-05', 'UTC')).toBe(false);
  });

  it('an early end brings the member back on the day it was ended, in the School\'s time zone', () => {
    // 23:30 in New York on 5 Nov is already 6 Nov in UTC.
    const f = approved('a', '2026-11-02', '2026-11-12', new Date('2026-11-06T04:30:00.000Z'));
    expect(backDay(f, 'America/New_York')).toBe(dayNumber('2026-11-05'));
    expect(backDay(f, 'UTC')).toBe(dayNumber('2026-11-06'));
    expect(frozenDays(f, 'America/New_York')).toBe(3);
    // Ended before it started: no days frozen.
    expect(frozenDays(approved('b', '2026-11-20', '2026-11-30', new Date('2026-11-01T12:00:00Z')), 'UTC')).toBe(0);
  });

  it('shows the running or next approved freeze, else the latest request', () => {
    const later = approved('later', '2026-12-01', '2026-12-10');
    const now = approved('now', '2026-11-01', '2026-11-10');
    const asked = { id: 'asked', status: 'REQUESTED', startsAt: d('2027-01-01'), endsAt: d('2027-01-10'), endedEarlyAt: null, createdAt: d('2026-11-03') };
    expect(currentFreeze([later, now, asked], '2026-11-05', 'UTC')?.id).toBe('now');
    expect(currentFreeze([later, asked], '2026-11-05', 'UTC')?.id).toBe('later');
    expect(currentFreeze([asked], '2026-11-05', 'UTC')?.id).toBe('asked');
  });

  describe('assertFreezeAllowed', () => {
    const base = { today: '2026-11-01', maxDays: 90, others: [], zone: 'UTC' };
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return (err as FreezeRuleError).code;
      }
      return null;
    };

    it('needs 7 days or more, from today on', () => {
      expect(assertFreezeAllowed({ ...base, startsAt: '2026-11-01', endsAt: '2026-11-08' })).toBe(7);
      expect(code(() => assertFreezeAllowed({ ...base, startsAt: '2026-11-01', endsAt: '2026-11-07' }))).toBe('FREEZE_TOO_SHORT');
      expect(code(() => assertFreezeAllowed({ ...base, startsAt: '2026-10-31', endsAt: '2026-11-20' }))).toBe('FREEZE_START_PASSED');
      expect(code(() => assertFreezeAllowed({ ...base, startsAt: 'nope', endsAt: '2026-11-20' }))).toBe('FREEZE_DATES_REQUIRED');
    });

    it('refuses an overlap with a request or a running freeze, but not with one ended early', () => {
      const others = [approved('a', '2026-11-10', '2026-11-20')];
      expect(code(() => assertFreezeAllowed({ ...base, others, startsAt: '2026-11-15', endsAt: '2026-11-25' }))).toBe('FREEZE_OVERLAP');
      expect(assertFreezeAllowed({ ...base, others, startsAt: '2026-11-20', endsAt: '2026-11-27' })).toBe(7);
      const ended = [approved('b', '2026-11-01', '2026-11-20', new Date('2026-11-05T10:00:00Z'))];
      expect(assertFreezeAllowed({ ...base, others: ended, startsAt: '2026-11-06', endsAt: '2026-11-13' })).toBe(7);
      // The request being approved doesn't overlap itself.
      const request = [{ ...approved('r', '2026-11-02', '2026-11-12'), status: 'REQUESTED' }];
      expect(assertFreezeAllowed({ ...base, others: request, ignoreId: 'r', startsAt: '2026-11-02', endsAt: '2026-11-12' })).toBe(10);
    });

    it('counts approved days in the 12 months before the new freeze ends', () => {
      const others = [approved('a', '2026-01-01', '2026-03-01')]; // 59 days: 31 more fit, 32 don't
      expect(code(() => assertFreezeAllowed({ ...base, maxDays: 90, others, startsAt: '2026-11-01', endsAt: '2026-12-03' }))).toBe('FREEZE_OVER_LIMIT');
      expect(assertFreezeAllowed({ ...base, maxDays: 90, others, startsAt: '2026-11-01', endsAt: '2026-12-01' })).toBe(30);
      // A year later the old freeze no longer counts.
      expect(assertFreezeAllowed({ ...base, today: '2027-03-01', maxDays: 90, others, startsAt: '2027-03-02', endsAt: '2027-05-31' })).toBe(90);
    });
  });
});
