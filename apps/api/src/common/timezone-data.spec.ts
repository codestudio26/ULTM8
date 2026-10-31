import { DateTime } from 'luxon';

// Class times, booking weeks and grading days all use the runtime's time-zone
// data (Intl, which luxon reads). Node 20 and Node 22 before 22.23 carry data
// older than 2026b, which doesn't know British Columbia stays on UTC-7 from
// 1 Nov 2026: Vancouver classes would come out an hour off (stress test round 4,
// TZ1). This fails on such a runtime, so CI catches it before a deploy does.
describe('time-zone data', () => {
  it('knows British Columbia stays on UTC-7 after 1 Nov 2026', () => {
    const afterChange = DateTime.fromISO('2026-11-10T18:00:00Z').setZone('America/Vancouver');
    expect(afterChange.offset).toBe(-7 * 60);
    expect(afterChange.toFormat('HH:mm')).toBe('11:00');
  });

  it('still moves the clocks back elsewhere in North America (Los Angeles, Toronto)', () => {
    expect(DateTime.fromISO('2026-11-10T18:00:00Z').setZone('America/Los_Angeles').offset).toBe(-8 * 60);
    expect(DateTime.fromISO('2026-11-10T18:00:00Z').setZone('America/Toronto').offset).toBe(-5 * 60);
  });
});
