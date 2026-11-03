/**
 * Decision 422 item 8: when both records being merged have a belt in the
 * same style, the higher current belt is kept. Pure helpers; the service
 * reads the rows and runs the statements.
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

export type SkillStatus = 'NOT_STARTED' | 'LEARNING' | 'SIGNED_OFF';
const SKILL_ORDER: Record<SkillStatus, number> = { NOT_STARTED: 0, LEARNING: 1, SIGNED_OFF: 2 };

/** The further of two sign-off statuses for the same skill on the same rung. */
export function furtherSkillStatus(a: SkillStatus, b: SkillStatus): SkillStatus {
  return SKILL_ORDER[b] > SKILL_ORDER[a] ? b : a;
}

/** Classes counted toward the next rung per class type, added together. */
export function addClassCounts(a: unknown, b: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const counts of [a, b]) {
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) continue;
    for (const [type, n] of Object.entries(counts as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isFinite(n)) out[type] = (out[type] ?? 0) + n;
    }
  }
  return out;
}
