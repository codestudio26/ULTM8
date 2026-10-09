import { dayNumber, weekStart } from './days';
import { CountRules } from './requirement';

/**
 * Grading engine — which attended classes count toward the next rung
 * (Decisions 140, 149, 171):
 * - A class counts if its type is ticked on the rung. Nothing ticked means
 *   every class counts.
 * - Weekly cap: weeks run Monday to Sunday. Within a week, the first classes
 *   up to the cap count, in date order; the extras are ignored, not carried
 *   over. A cap that is missing or 0 means no limit.
 * The cap is applied to the classes that count, so an unticked class never
 * uses up a week's allowance.
 * A class whose day can't be read is not counted.
 */

export interface AttendedClass {
  /** The class's calendar day in local time, YYYY-MM-DD. */
  day: string;
  /** Orders classes on the same day (e.g. start time as ISO). Optional. */
  at?: string;
  classType: string | null;
}

export interface ClassTally {
  total: number;
  /** Counted classes per type. Classes with no type are in `total` only. */
  byType: Record<string, number>;
}

export function countClasses(attended: AttendedClass[], rules: CountRules): ClassTally {
  const ticked = rules.eligibleClassTypes;
  const cap = rules.weeklyClassCountCap && rules.weeklyClassCountCap > 0 ? rules.weeklyClassCountCap : null;

  const counting = attended
    .map((c, i) => ({ c, i, dayNum: dayNumber(c.day) }))
    .filter(({ c, dayNum }) => dayNum !== null && (ticked.length === 0 || (c.classType !== null && ticked.includes(c.classType))))
    .sort((a, b) => (a.dayNum as number) - (b.dayNum as number) || (a.c.at ?? '').localeCompare(b.c.at ?? '') || a.i - b.i);

  const perWeek = new Map<number, number>();
  const tally: ClassTally = { total: 0, byType: {} };
  for (const { c, dayNum } of counting) {
    if (cap !== null) {
      const week = weekStart(dayNum as number);
      const used = perWeek.get(week) ?? 0;
      if (used >= cap) continue;
      perWeek.set(week, used + 1);
    }
    tally.total += 1;
    if (c.classType !== null) tally.byType[c.classType] = (tally.byType[c.classType] ?? 0) + 1;
  }
  return tally;
}
