import type { TranslationKey } from '../i18n/I18nProvider';
import type { Rung } from './ladder';

/** A history entry's type, as people read it (Decisions 129, 166). */
export const HISTORY_TYPE_LABEL: Record<string, TranslationKey> = {
  PROMOTION: 'grading.student.history.types.promotion',
  BULK_PROMOTION: 'grading.student.history.types.bulkPromotion',
  STRIPE_AWARD: 'grading.student.history.types.stripeAward',
  BULK_STRIPE_AWARD: 'grading.student.history.types.bulkStripeAward',
  DOWNGRADE: 'grading.student.history.types.downgrade',
  SELF_DECLARED: 'grading.student.history.types.selfDeclared',
  RANK_CORRECTION: 'grading.student.history.types.rankCorrection',
  ADJUSTMENT: 'grading.student.history.types.adjustment',
};

/** On a Levels style a stripe award is a step up inside a level (Decision 402). */
const LEVELS_TYPE_LABEL: Record<string, TranslationKey> = {
  STRIPE_AWARD: 'grading.student.history.types.stepUp',
  BULK_STRIPE_AWARD: 'grading.student.history.types.bulkStepUp',
};

/** The label key for a history entry's type, in the wording of the style its
 * rung belongs to: "Step up" instead of "Stripe awarded" on a Levels style
 * (Decision 402). Undefined for a type with no label (shown as it is). */
export function historyTypeLabel(type: string, rankDisplay: 'BELTS' | 'LEVELS' | null | undefined): TranslationKey | undefined {
  return (rankDisplay === 'LEVELS' ? LEVELS_TYPE_LABEL[type] : undefined) ?? HISTORY_TYPE_LABEL[type];
}

/** How the style of a history entry shows its ranks, from the rung it moved to
 * in that style's ladder (else its rank). The setting is one per style
 * (Decision 401), so a rung no longer in the ladder takes the ladder's. */
export function eventRankDisplay(
  ladder: Pick<Rung, 'id' | 'rankId' | 'rank'>[],
  event: { toStripeTierId?: string | null; toRankId?: string | null },
): 'BELTS' | 'LEVELS' | undefined {
  const rung = ladder.find((r) => r.id === event.toStripeTierId) ?? ladder.find((r) => r.rankId === event.toRankId) ?? ladder[0];
  return rung?.rank.rankDisplay;
}
