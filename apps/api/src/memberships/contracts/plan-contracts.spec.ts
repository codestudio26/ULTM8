import { contractSha256, earlyExitFeeDue, minimumTermEndsAt } from './plan-contracts.service';
import { minimumTermEndsAtWithFreezes } from './minimum-term';

describe('Decision 316 item 6 — plan contracts', () => {
  it('the minimum term ends whole calendar months after the membership starts', () => {
    expect(minimumTermEndsAt(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(minimumTermEndsAt(new Date('2026-03-15T00:00:00Z'), 12).toISOString()).toBe('2027-03-15T00:00:00.000Z');
  });

  it('the fee is due only when the membership ends before the term does, and only when there is a fee', () => {
    const start = { startDate: new Date('2026-01-01T00:00:00Z') };
    const terms = { minimumTermMonths: 12, earlyExitFee: 5000 };
    expect(earlyExitFeeDue(terms, start, new Date('2026-06-01T00:00:00Z'))).toBe(true);
    expect(earlyExitFeeDue(terms, start, new Date('2027-01-01T00:00:00Z'))).toBe(false);
    expect(earlyExitFeeDue(terms, start, new Date('2027-02-01T00:00:00Z'))).toBe(false);
    expect(earlyExitFeeDue({ minimumTermMonths: 12, earlyExitFee: 0 }, start, new Date('2026-06-01T00:00:00Z'))).toBe(false);
    expect(earlyExitFeeDue({ minimumTermMonths: 12, earlyExitFee: null }, start, new Date('2026-06-01T00:00:00Z'))).toBe(false);
    expect(earlyExitFeeDue({ minimumTermMonths: null, earlyExitFee: null }, start, new Date('2026-06-01T00:00:00Z'))).toBe(false);
  });

  it('Decision 435 item 17: a freeze pushes the end of the minimum term back by the days it freezes', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const f = (startsAt: string, endsAt: string, extra: Partial<{ status: string; endedEarlyAt: Date | null }> = {}) => ({
      status: 'APPROVED',
      startsAt: new Date(`${startsAt}T00:00:00Z`),
      endsAt: new Date(`${endsAt}T00:00:00Z`),
      endedEarlyAt: null,
      ...extra,
    });
    // No freeze: the plain term.
    expect(minimumTermEndsAtWithFreezes(start, 6, [], 'UTC').toISOString()).toBe('2026-07-01T00:00:00.000Z');
    // A 14-day freeze inside the term.
    expect(minimumTermEndsAtWithFreezes(start, 6, [f('2026-03-01', '2026-03-15')], 'UTC').toISOString()).toBe('2026-07-15T00:00:00.000Z');
    // Ended early after 4 days: only those count.
    expect(
      minimumTermEndsAtWithFreezes(start, 6, [f('2026-03-01', '2026-03-15', { endedEarlyAt: new Date('2026-03-05T12:00:00Z') })], 'UTC').toISOString(),
    ).toBe('2026-07-05T00:00:00.000Z');
    // Requested, declined or withdrawn freezes don't count; one after the term ended doesn't either.
    expect(
      minimumTermEndsAtWithFreezes(start, 6, [f('2026-03-01', '2026-03-15', { status: 'REQUESTED' }), f('2026-08-01', '2026-08-15')], 'UTC').toISOString(),
    ).toBe('2026-07-01T00:00:00.000Z');
    // A freeze starting in the days an earlier freeze added still counts.
    expect(minimumTermEndsAtWithFreezes(start, 6, [f('2026-06-20', '2026-07-01'), f('2026-07-05', '2026-07-10')], 'UTC').toISOString()).toBe(
      '2026-07-17T00:00:00.000Z',
    );
    // The fee check uses the pushed end.
    const pushed = minimumTermEndsAtWithFreezes(start, 6, [f('2026-03-01', '2026-03-15')], 'UTC');
    expect(earlyExitFeeDue({ minimumTermMonths: 6, earlyExitFee: 100 }, { startDate: start }, new Date('2026-07-10T00:00:00Z'), pushed)).toBe(true);
    expect(earlyExitFeeDue({ minimumTermMonths: 6, earlyExitFee: 100 }, { startDate: start }, new Date('2026-07-10T00:00:00Z'))).toBe(false);
  });

  it("the signed text's fingerprint is its SHA-256", () => {
    expect(contractSha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
