import { describe, expect, it } from '@jest/globals';
import { eventRankDisplay, historyTypeLabel } from './historyLabels';

/** Decision 402: on a Levels style a stripe award reads "Step up"; a promotion
 * to a new level, and everything on a Belts style, keeps its wording. */
describe('history labels', () => {
  it('says "Step up" for a stripe award on a Levels style', () => {
    expect(historyTypeLabel('STRIPE_AWARD', 'LEVELS')).toBe('grading.student.history.types.stepUp');
    expect(historyTypeLabel('BULK_STRIPE_AWARD', 'LEVELS')).toBe('grading.student.history.types.bulkStepUp');
  });

  it('keeps "Promoted" on a Levels style, and every label on a Belts style', () => {
    expect(historyTypeLabel('PROMOTION', 'LEVELS')).toBe('grading.student.history.types.promotion');
    expect(historyTypeLabel('BULK_PROMOTION', 'LEVELS')).toBe('grading.student.history.types.bulkPromotion');
    expect(historyTypeLabel('STRIPE_AWARD', 'BELTS')).toBe('grading.student.history.types.stripeAward');
    expect(historyTypeLabel('BULK_STRIPE_AWARD', undefined)).toBe('grading.student.history.types.bulkStripeAward');
    expect(historyTypeLabel('SOMETHING_NEW', 'LEVELS')).toBeUndefined();
  });

  it("reads the style's setting from the rung the entry moved to", () => {
    const levels = { rankDisplay: 'LEVELS' as const };
    const ladder = [
      { id: 'n1', rankId: 'beginner', rank: levels },
      { id: 'n2', rankId: 'beginner', rank: levels },
    ] as unknown as Parameters<typeof eventRankDisplay>[0];
    expect(eventRankDisplay(ladder, { toStripeTierId: 'n2', toRankId: 'beginner' })).toBe('LEVELS');
    expect(eventRankDisplay(ladder, { toStripeTierId: 'gone', toRankId: 'beginner' })).toBe('LEVELS');
    expect(eventRankDisplay([], { toStripeTierId: 'n2' })).toBeUndefined();
  });
});
