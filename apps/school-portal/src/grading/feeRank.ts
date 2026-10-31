import type { TranslateFn } from '../i18n/I18nProvider';

/** What a promotion fee request says about where the grade goes. */
interface FeeTarget {
  toRungName: string;
  /** The board's request: the grade moves the student into the linked Adult program. */
  toAdult?: boolean;
  /** The student's requests: the Adult style, for a move into it. */
  toDisciplineId?: string | null;
}

/** The rank a promotion fee is for, as shown: "Blue Belt (Adult program)"
 * when the grade moves a Kids student into the linked Adult program, which is
 * charged like any other promotion (Decision 419 item 2). */
export function feeRankName(r: FeeTarget, t: TranslateFn): string {
  return r.toAdult || r.toDisciplineId ? `${r.toRungName} ${t('grading.bulk.adultTag')}` : r.toRungName;
}

/** The style card a fee shows on: the style the student was graded from, or,
 * for a move into the linked Adult program that has applied, the Adult style
 * where their rank now is (Decision 419 item 2). */
export function feeStyleOf(r: { disciplineId: string; toDisciplineId?: string | null; promotionApplied: boolean }): string {
  return r.toDisciplineId && r.promotionApplied ? r.toDisciplineId : r.disciplineId;
}
