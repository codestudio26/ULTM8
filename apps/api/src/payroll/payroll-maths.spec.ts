import { classMinutes, payFor, presetRange, rangeDays } from './payroll-maths';

describe('payroll maths (Decision 320 item 4)', () => {
  // 15 Mar 2027, 01:30 UTC: still 14 Mar in New York.
  const now = new Date('2027-03-15T01:30:00Z');

  it('works out each preset in the School zone, ending today', () => {
    expect(presetRange('LAST_14_DAYS', now, 'UTC')).toEqual({ from: '2027-03-02', to: '2027-03-15' });
    expect(presetRange('LAST_30_DAYS', now, 'UTC')).toEqual({ from: '2027-02-14', to: '2027-03-15' });
    expect(presetRange('THIS_MONTH', now, 'UTC')).toEqual({ from: '2027-03-01', to: '2027-03-15' });
    expect(presetRange('LAST_MONTH', now, 'UTC')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(presetRange('LAST_12_MONTHS', now, 'UTC')).toEqual({ from: '2026-03-16', to: '2027-03-15' });
    expect(presetRange('LAST_14_DAYS', now, 'America/New_York')).toEqual({ from: '2027-03-01', to: '2027-03-14' });
  });

  it('keeps last month whole across a year end', () => {
    expect(presetRange('LAST_MONTH', new Date('2027-01-10T12:00:00Z'), 'UTC')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('counts the days in a range, both ends included', () => {
    expect(rangeDays('2027-03-01', '2027-03-01')).toBe(1);
    expect(rangeDays('2027-02-01', '2027-02-28')).toBe(28);
    const year = presetRange('LAST_12_MONTHS', new Date('2028-03-15T12:00:00Z'), 'UTC');
    expect(rangeDays(year.from, year.to)).toBe(366);
  });

  it("measures a class from its start to its end", () => {
    expect(classMinutes(new Date('2027-03-01T18:00:00Z'), new Date('2027-03-01T19:30:00Z'))).toBe(90);
    expect(classMinutes(new Date('2027-03-01T18:00:00Z'), new Date('2027-03-01T17:00:00Z'))).toBe(0);
  });

  it('adds hours × hourly rate and classes × per-class rate, a blank rate adding nothing', () => {
    // 3 classes, 4.5 hours: 4.5 × 20.00 + 3 × 5.00 = 105.00
    expect(payFor(270, 3, 2000, 500)).toBe(10500);
    expect(payFor(270, 3, null, 500)).toBe(1500);
    expect(payFor(270, 3, 2000, null)).toBe(9000);
    expect(payFor(0, 0, 2000, 500)).toBe(0);
  });

  it('rounds the hourly part once, half up', () => {
    // 50 minutes at 10.01/hour = 8.341666… → 8.34
    expect(payFor(50, 1, 1001, null)).toBe(834);
    // 30 minutes at 0.01/hour = 0.005 → 0.01
    expect(payFor(30, 1, 1, null)).toBe(1);
  });
});
