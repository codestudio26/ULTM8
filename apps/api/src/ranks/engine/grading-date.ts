import { dayNumber } from './days';

/**
 * Grading engine — a back-dated grading date (Decision 128, item 8): never in
 * the future, and never before the day the student reached their current rung.
 * The same day is allowed. Returns why the date is refused, or null when it is
 * fine. Days are local YYYY-MM-DD.
 */
export type GradingDateProblem = 'INVALID' | 'IN_FUTURE' | 'BEFORE_CURRENT_RANK';

export function gradingDateProblem(date: string, today: string, currentRankDate: string | null): GradingDateProblem | null {
  const d = dayNumber(date);
  const t = dayNumber(today);
  if (d === null || t === null) return 'INVALID';
  if (d > t) return 'IN_FUTURE';
  const since = dayNumber(currentRankDate);
  if (since !== null && d < since) return 'BEFORE_CURRENT_RANK';
  return null;
}
