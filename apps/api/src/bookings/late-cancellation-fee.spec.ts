import { lateCancellationFee } from './late-cancellation-fee';

describe('lateCancellationFee (Decision 389)', () => {
  it("charges the Class's own fee, even when the plan has one too", () => {
    expect(lateCancellationFee(500, 900)).toBe(500);
  });

  it("falls back to the plan's fee when the Class has none", () => {
    expect(lateCancellationFee(null, 900)).toBe(900);
  });

  it('charges nothing when neither has a fee, or the one that applies is 0', () => {
    expect(lateCancellationFee(null, null)).toBeNull();
    expect(lateCancellationFee(null, 0)).toBeNull();
    expect(lateCancellationFee(0, 900)).toBeNull();
  });
});
