/**
 * Decision 422 item 8: when both records being merged have a belt in the
 * same style, the higher current belt is kept. Pure helpers; the service
 * decides, and merge_student_ranks (a database function) does the writes.
 */

/** Where a member stands on a style's ladder: the belt's `order`, then the
 * stripe tier's (or level step's) `order` within it — the order the grading
 * engine flattens the ladder in (engine/ladder.ts, flattenLadder). */
export interface LadderPosition {
  rankOrder: number;
  /** Null when the member has no stripe tier on the belt: below its first tier. */
  tierOrder: number | null;
}

/** Negative when `a` is lower, 0 on the same rung, positive when `a` is higher. */
export function compareLadderPositions(a: LadderPosition, b: LadderPosition): number {
  if (a.rankOrder !== b.rankOrder) return a.rankOrder - b.rankOrder;
  return (a.tierOrder ?? -1) - (b.tierOrder ?? -1);
}

/** Whose belt is kept: the duplicate's only when it is strictly higher. */
export function keptBeltOwner(kept: LadderPosition, duplicate: LadderPosition): 'KEPT' | 'DUPLICATE' {
  return compareLadderPositions(duplicate, kept) > 0 ? 'DUPLICATE' : 'KEPT';
}
