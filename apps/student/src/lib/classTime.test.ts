import { describe, expect, it } from '@jest/globals';
import { classZone, endsNextDayInZone, formatInZone, formatTimeInZone } from './classTime';

describe('classTime', () => {
  it("uses the Branch's zone, else the School's, else UTC", () => {
    expect(classZone('Asia/Tokyo', 'Europe/London')).toBe('Asia/Tokyo');
    expect(classZone(null, 'Europe/London')).toBe('Europe/London');
    expect(classZone(undefined, null)).toBe('UTC');
  });

  it('falls back to UTC for a zone the device does not know, instead of crashing', () => {
    expect(classZone('Not/AZone', null)).toBe('UTC');
    expect(formatTimeInZone('2030-01-08T17:00:00Z', 'Not/AZone')).toMatch(/5:00\sPM/);
  });

  it("formats on the zone's clock, not the phone's", () => {
    expect(formatInZone('2030-01-08T17:00:00Z', 'Asia/Tokyo')).toMatch(/^Jan 9, 2030, 2:00\sAM$/);
    expect(formatTimeInZone('2030-01-08T17:00:00Z', 'America/New_York')).toMatch(/^12:00\sPM$/);
  });

  it("knows a class ends the next day on the zone's clock (Decision 432 item 3)", () => {
    // 23:00–00:30 in New York, which is the same UTC day.
    expect(endsNextDayInZone('2030-01-09T04:00:00Z', '2030-01-09T05:30:00Z', 'America/New_York')).toBe(true);
    // 18:00–19:30 UTC stays on one day; 23:30–00:30 in Tokyo does not.
    expect(endsNextDayInZone('2030-01-08T18:00:00Z', '2030-01-08T19:30:00Z', 'UTC')).toBe(false);
    expect(endsNextDayInZone('2030-01-08T14:30:00Z', '2030-01-08T15:30:00Z', 'Asia/Tokyo')).toBe(true);
  });
});
