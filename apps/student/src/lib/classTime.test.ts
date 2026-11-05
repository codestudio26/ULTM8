import { describe, expect, it } from '@jest/globals';
import { classZone, formatInZone, formatTimeInZone } from './classTime';

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
});
