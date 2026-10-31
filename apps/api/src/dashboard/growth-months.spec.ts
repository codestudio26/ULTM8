import { growthWindow, monthOf, monthOfDay } from './growth-months';

describe('Growth months (backlog 5.8)', () => {
  it('gives the last 12 months, this one last, in the School time zone', () => {
    const w = growthWindow(new Date('2026-10-31T12:00:00Z'), 'UTC');
    expect(w.months).toHaveLength(12);
    expect(w.months[0]).toBe('2025-11');
    expect(w.months[11]).toBe('2026-10');
    expect(w.firstDay).toBe('2025-11-01');
    expect(w.from.toISOString()).toBe('2025-11-01T00:00:00.000Z');
  });

  it('is already next month in Tokyo while it is still the last day in UTC', () => {
    const now = new Date('2026-10-31T16:00:00Z'); // 1 Nov 01:00 in Tokyo
    const w = growthWindow(now, 'Asia/Tokyo');
    expect(w.months[11]).toBe('2026-11');
    expect(w.firstDay).toBe('2025-12-01');
    // Local midnight on 1 December 2025 in Tokyo (UTC+9).
    expect(w.from.toISOString()).toBe('2025-11-30T15:00:00.000Z');
  });

  it('puts an instant in the month it falls in locally', () => {
    expect(monthOf(new Date('2026-09-30T15:30:00Z'), 'Asia/Tokyo')).toBe('2026-10');
    expect(monthOf(new Date('2026-09-30T15:30:00Z'), 'UTC')).toBe('2026-09');
    expect(monthOf(new Date('2026-11-01T03:00:00Z'), 'America/New_York')).toBe('2026-10');
  });

  it('reads a stored calendar day as its own month', () => {
    expect(monthOfDay(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10');
  });
});
