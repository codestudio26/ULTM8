import type { TranslateFn } from '../i18n/types';
import type { FeeRequest } from './myGradingQueries';

/**
 * "You were graded to Purple Belt", or for a move from the Kids program into
 * the Adult program, which is charged like any other promotion (Decision 419
 * item 2), "You were graded into the Adult program, to Blue Belt". A
 * guardian's version names the child.
 */
export function feeGradedText(r: FeeRequest, childName: string | null, t: TranslateFn): string {
  if (r.toDisciplineId) {
    return childName ? t('grading.fee.gradedChildAdult', { name: childName, rank: r.toRungName }) : t('grading.fee.gradedSelfAdult', { rank: r.toRungName });
  }
  return childName ? t('grading.fee.gradedChild', { name: childName, rank: r.toRungName }) : t('grading.fee.gradedSelf', { rank: r.toRungName });
}

/** The style the fee's rank belongs to: the Adult style for a move into it. */
export function feeStyleName(r: FeeRequest): string | undefined {
  return r.toDisciplineName ?? r.disciplineName;
}
