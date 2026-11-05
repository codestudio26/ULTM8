import { contractSha256, earlyExitFeeDue, minimumTermEndsAt } from './plan-contracts.service';

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

  it("the signed text's fingerprint is its SHA-256", () => {
    expect(contractSha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
