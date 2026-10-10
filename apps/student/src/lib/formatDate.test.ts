import { describe, expect, it } from '@jest/globals';
import { formatDate, formatDateOnly, formatDateTime } from './formatDate';

describe('formatDate', () => {
  it('formats an ISO timestamp as a medium date', () => {
    expect(formatDate('2026-06-01T12:00:00.000Z')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date('2026-06-01T12:00:00.000Z')),
    );
  });

  it('falls back to the raw string on an unparseable value', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDateTime', () => {
  it('formats an ISO timestamp with both date and time', () => {
    expect(formatDateTime('2026-06-01T12:00:00.000Z')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date('2026-06-01T12:00:00.000Z'),
      ),
    );
  });

  it('falls back to the raw string on an unparseable value', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDateOnly', () => {
  it('does not shift a UTC-midnight date-only value back a calendar day', () => {
    // The exact bug formatDateOnly exists to avoid: a date-only value serialized as
    // UTC midnight must render as the same calendar day everywhere, not shift back
    // a day for a viewer behind UTC (formatDate's own local-timezone behavior would
    // do that, which is correct for a real instant but wrong for a date-only value).
    expect(formatDateOnly('2015-06-01T00:00:00.000Z')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date('2015-06-01T00:00:00.000Z'),
      ),
    );
  });

  it('falls back to the raw string on an unparseable value', () => {
    expect(formatDateOnly('not-a-date')).toBe('not-a-date');
  });
});
