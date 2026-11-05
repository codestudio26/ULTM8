import { classTimeZone } from './class-time-zone';

describe('classTimeZone (Decision 427, SP6)', () => {
  it("uses the Branch's zone, else the School's, else null", () => {
    expect(classTimeZone('Asia/Tokyo', 'Europe/London')).toBe('Asia/Tokyo');
    expect(classTimeZone(null, 'Europe/London')).toBe('Europe/London');
    expect(classTimeZone('', 'Europe/London')).toBe('Europe/London');
    expect(classTimeZone(undefined, null)).toBeNull();
  });
});
