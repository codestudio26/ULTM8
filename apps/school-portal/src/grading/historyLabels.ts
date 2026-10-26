import type { TranslationKey } from '../i18n/I18nProvider';

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
