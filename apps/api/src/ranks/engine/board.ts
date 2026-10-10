import { BoardColumn, BoardThresholds, DEFAULT_BOARD_THRESHOLDS } from './eligibility';
import { Requirement } from './requirement';

/**
 * Grading engine — moving a student to a Grading Board column by hand
 * (Decision 128, item 13; Decision 174; prototype `dropOnBand`).
 */

/** The smallest count whose re-displayed, rounded % is still at least the
 * column's floor — a naive round(total * floor) can round back below it
 * (8 classes at 66% -> 5 -> 63%). Prototype `snapCountForFloor`. */
export function snapCountForFloor(total: number, floorPct: number): number {
  if (floorPct <= 0 || total <= 0) return 0;
  return Math.min(total, Math.max(0, Math.ceil((total * (floorPct - 0.5)) / 100)));
}

export function columnFloor(column: BoardColumn, thresholds: BoardThresholds = DEFAULT_BOARD_THRESHOLDS): number {
  if (column === 'READY_TO_GRADE') return thresholds.readyToGrade;
  if (column === 'GETTING_THERE') return thresholds.gettingThere;
  return 0;
}

export type BoardMove =
  /** A time-only rung: the rank date moves so this many days have passed. */
  | { kind: 'DAYS'; daysInRank: number }
  /** Classes: the total, and per type on an "each type" rung (Decision 174:
   * every type set to the column's % of its own number). */
  | { kind: 'CLASSES'; total: number; byType: Record<string, number> | null }
  /** Nothing to adjust: no next rung, or nothing required to split into columns. */
  | { kind: 'NOT_MOVABLE' };

export function boardMove(req: Requirement, column: BoardColumn, thresholds: BoardThresholds = DEFAULT_BOARD_THRESHOLDS): BoardMove {
  if (req.kind !== 'NEXT') return { kind: 'NOT_MOVABLE' };
  const floor = columnFloor(column, thresholds);
  if (req.timeOnly) {
    return req.requiredDays > 0 ? { kind: 'DAYS', daysInRank: snapCountForFloor(req.requiredDays, floor) } : { kind: 'NOT_MOVABLE' };
  }
  if (req.requiredClasses <= 0) return { kind: 'NOT_MOVABLE' };
  if (req.countRules.classCountMode === 'EACH_TYPE') {
    const byType: Record<string, number> = {};
    for (const r of req.countRules.classTypeRequirements) byType[r.classType] = snapCountForFloor(r.classesRequired, floor);
    return { kind: 'CLASSES', total: Object.values(byType).reduce((s, n) => s + n, 0), byType };
  }
  return { kind: 'CLASSES', total: snapCountForFloor(req.requiredClasses, floor), byType: null };
}
