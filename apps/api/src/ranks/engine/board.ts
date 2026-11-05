import { dayNumber } from './days';
import { boardColumn, BoardColumn, BoardThresholds, computeEligibility, DEFAULT_BOARD_THRESHOLDS, StudentProgressInput } from './eligibility';
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

/** A drag when the % is the average of several requirements (Decision 321
 * item 7). What it rewrites: the class count (each type on an "each type"
 * rung, Decision 174) and, only if the classes alone can't put the student in
 * that column, the time-in-rank start date too; on a time-only rung, the date
 * only. Skills, hours and days attended are never rewritten by a drag. */
export type AveragedBoardMove =
  | { kind: 'NOT_MOVABLE' }
  /** Neither the classes nor the days can put the student in that column
   * (their other requirements already count for more, or for too little). */
  | { kind: 'CANNOT_REACH' }
  | { kind: 'ADJUST'; classes: { total: number; byType: Record<string, number> | null } | null; daysInRank: number | null };

const COLUMNS: BoardColumn[] = ['JUST_STARTING', 'GETTING_THERE', 'READY_TO_GRADE'];

/**
 * The smallest rewrite that puts the student in `column`: the class count
 * snapped to each % from 0 to 100 (prototype `snapCountForFloor`), the first
 * that lands there. With classes the only requirement this is exactly the
 * prototype's drag (the column's floor). If no class count lands there, the
 * classes go to all (moving up) or none (moving down) and the start date is
 * snapped the same way. Pure: the caller writes it.
 */
export function boardMoveAveraged(
  req: Requirement,
  input: StudentProgressInput,
  column: BoardColumn,
  thresholds: BoardThresholds = DEFAULT_BOARD_THRESHOLDS,
): AveragedBoardMove {
  if (req.kind !== 'NEXT') return { kind: 'NOT_MOVABLE' };
  const bandOf = (inp: StudentProgressInput) => {
    const e = computeEligibility(req, inp);
    return e.hasNext ? boardColumn(e.progressPercent, thresholds) : null;
  };
  const today = dayNumber(input.today);
  if (today === null) return { kind: 'NOT_MOVABLE' };
  const dayBack = (n: number) => new Date((today - n) * 86_400_000).toISOString().slice(0, 10);
  const canClasses = !req.timeOnly && req.requiredClasses > 0;
  const canDays = req.requiredDays > 0;
  if (!canClasses && !canDays) return { kind: 'NOT_MOVABLE' };

  const classesAt = (pct: number) => {
    if (req.countRules.classCountMode === 'EACH_TYPE') {
      const byType: Record<string, number> = {};
      for (const r of req.countRules.classTypeRequirements) byType[r.classType] = snapCountForFloor(r.classesRequired, pct);
      return { total: Object.values(byType).reduce((s, n) => s + n, 0), byType };
    }
    return { total: snapCountForFloor(req.requiredClasses, pct), byType: null };
  };
  const withClasses = (inp: StudentProgressInput, c: { total: number; byType: Record<string, number> | null }): StudentProgressInput => ({
    ...inp,
    classes: { total: c.total, byType: c.byType ?? {} },
  });

  if (canClasses) {
    for (let pct = 0; pct <= 100; pct++) {
      const c = classesAt(pct);
      if (bandOf(withClasses(input, c)) === column) return { kind: 'ADJUST', classes: c, daysInRank: null };
    }
  }
  if (canDays) {
    const now = bandOf(input);
    const up = now === null || COLUMNS.indexOf(column) > COLUMNS.indexOf(now);
    const c = canClasses ? classesAt(up ? 100 : 0) : null;
    const base = c ? withClasses(input, c) : input;
    for (let pct = 0; pct <= 100; pct++) {
      const n = snapCountForFloor(req.requiredDays, pct);
      if (bandOf({ ...base, rankDate: dayBack(n) }) === column) return { kind: 'ADJUST', classes: c, daysInRank: n };
    }
  }
  return { kind: 'CANNOT_REACH' };
}
