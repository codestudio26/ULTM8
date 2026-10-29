import { hasReachedAge } from './kids-adult';

describe('hasReachedAge (backlog 3.20)', () => {
  const born = new Date('2010-06-15T00:00:00Z');
  it('counts whole years, birthday included', () => {
    expect(hasReachedAge(born, 16, '2026-06-14')).toBe(false);
    expect(hasReachedAge(born, 16, '2026-06-15')).toBe(true);
    expect(hasReachedAge(born, 16, '2027-01-01')).toBe(true);
    expect(hasReachedAge(born, 17, '2026-12-31')).toBe(false);
  });
  it('is never reached without a date of birth', () => {
    expect(hasReachedAge(null, 1, '2026-01-01')).toBe(false);
  });
});
