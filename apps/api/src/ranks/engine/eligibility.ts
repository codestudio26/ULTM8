import { ClassTally } from './class-count';
import { ageOn, daysSince } from './days';
import { Requirement } from './requirement';

/**
 * Grading engine — eligibility and progress (prototype `computeEligibility`,
 * `computeProgress`, `progressBand`; Decisions 127, 136, 149, 171, 321).
 */

export interface StudentProgressInput {
  /** The day the student reached their current rung (local, YYYY-MM-DD). */
  rankDate: string | null;
  /** Today (local, YYYY-MM-DD). */
  today: string;
  /** Classes counted toward the next rung. */
  classes: ClassTally;
  /** Skills signed off at the current position. */
  signedSkillIds: string[];
  /** Minutes trained that count toward hours, since the current rank date
   * (Decision 321 item 2). Read only when the requirement asks for hours. */
  minutesTrained?: number;
  /** Different days with a check-in to a class of the style since the current
   * rank date (Decision 321 item 3). Read only when asked for. */
  daysAttended?: number;
  /** YYYY-MM-DD, or null when unknown. Read only when the next rung has a
   * minimum age (Decision 321 item 4). */
  dateOfBirth?: string | null;
}

export interface TypeProgress {
  classType: string;
  required: number;
  counted: number;
}

export type Eligibility =
  | { hasNext: false; dataError: true }
  | { hasNext: false; dataError: false }
  | {
      hasNext: true;
      nextRungId: string;
      /** The current rung is time-only: days are the only gate. */
      timeOnly: boolean;
      elapsedDays: number;
      requiredDays: number;
      requiredClasses: number;
      countedClasses: number;
      /** EACH_TYPE only: one row per ticked type (Decision 149). */
      byType: TypeProgress[];
      classesOk: boolean;
      daysOk: boolean;
      skillsOk: boolean;
      /** Hours (Decision 321 item 2): 0 required when not asked for. */
      requiredHours: number;
      minutesTrained: number;
      hoursOk: boolean;
      /** Days attended (Decision 321 item 3): 0 required when not asked for. */
      requiredDaysAttended: number;
      daysAttended: number;
      daysAttendedOk: boolean;
      /** Minimum age of the next rung (Decision 321 item 4); null = any age. */
      minimumAge: number | null;
      /** False while the student is younger than minimumAge, or their date
       * of birth is unknown. */
      ageOk: boolean;
      /** Every ticked requirement is met but the student is too young:
       * "Waiting for age N" (Decision 321 item 7). Null otherwise. */
      waitingForAge: number | null;
      /** Every requirement met, minimum age included. */
      eligible: boolean;
      requiredSkillIds: string[];
      optionalSkillIds: string[];
      missingSkillIds: string[];
      /** The classes' own %, as the breakdown shows it. */
      classesPercent: number;
      /** 0–100. The average of the requirements the next rung asks for
       * (classes, days in rank, skills, hours, days attended), each capped
       * at 100% (Decision 321 item 7). Minimum age is not part of it. A
       * time-only rung counts its days. Nothing asked reads as 100. */
      progressPercent: number;
    };

export function computeEligibility(req: Requirement, input: StudentProgressInput): Eligibility {
  if (req.kind === 'DATA_ERROR') return { hasNext: false, dataError: true };
  if (req.kind === 'TOP') return { hasNext: false, dataError: false };

  const elapsedDays = daysSince(input.rankDate, input.today);
  const daysOk = elapsedDays >= req.requiredDays;
  const age = req.minimumAge !== null ? ageOn(input.dateOfBirth, input.today) : null;
  const ageOk = req.minimumAge === null || (age !== null && age >= req.minimumAge);

  if (req.timeOnly) {
    // 100% only once the days are served (Decision 321 item 7).
    const progressPercent = daysOk ? percent(elapsedDays, req.requiredDays) : Math.min(99, percent(elapsedDays, req.requiredDays));
    return {
      hasNext: true,
      nextRungId: req.next.id,
      timeOnly: true,
      elapsedDays,
      requiredDays: req.requiredDays,
      requiredClasses: 0,
      countedClasses: 0,
      byType: [],
      classesOk: true,
      daysOk,
      skillsOk: true,
      requiredHours: 0,
      minutesTrained: 0,
      hoursOk: true,
      requiredDaysAttended: 0,
      daysAttended: 0,
      daysAttendedOk: true,
      minimumAge: req.minimumAge,
      ageOk,
      waitingForAge: daysOk && !ageOk ? req.minimumAge : null,
      eligible: daysOk && ageOk,
      requiredSkillIds: [],
      optionalSkillIds: [...req.optionalSkillIds],
      missingSkillIds: [],
      classesPercent: 100,
      progressPercent,
    };
  }

  const signed = new Set(input.signedSkillIds);
  const missingSkillIds = req.requiredSkillIds.filter((id) => !signed.has(id));
  const skillsOk = missingSkillIds.length === 0;

  let classesOk: boolean;
  let byType: TypeProgress[] = [];
  let classesPercent: number;
  if (req.requiredClasses <= 0) {
    // Not asked for (none required, or the style doesn't tick Classes).
    classesOk = true;
    classesPercent = 100;
  } else if (req.countRules.classCountMode === 'EACH_TYPE') {
    byType = req.countRules.classTypeRequirements.map((r) => ({
      classType: r.classType,
      required: r.classesRequired,
      counted: input.classes.byType[r.classType] ?? 0,
    }));
    classesOk = byType.every((t) => t.counted >= t.required);
    // Combined, each type capped at its own number: 18/20 + 4/10 is 22/30 = 73% (Decision 171).
    const done = byType.reduce((sum, t) => sum + Math.min(t.counted, t.required), 0);
    classesPercent = percent(done, req.requiredClasses);
  } else {
    classesOk = input.classes.total >= req.requiredClasses;
    classesPercent = percent(input.classes.total, req.requiredClasses);
  }

  const minutesTrained = req.requiredHours > 0 ? Math.max(0, input.minutesTrained ?? 0) : 0;
  const hoursOk = minutesTrained >= req.requiredHours * 60;
  const daysAttended = req.requiredDaysAttended > 0 ? Math.max(0, input.daysAttended ?? 0) : 0;
  const daysAttendedOk = daysAttended >= req.requiredDaysAttended;

  // The average of what the next rung asks for, each capped at 100% (Decision
  // 321 item 7): 30/40 classes, 90/180 days, 4/8 skills -> (75 + 50 + 50) / 3 = 58%.
  const parts: number[] = [];
  if (req.requiredClasses > 0) {
    if (req.countRules.classCountMode === 'EACH_TYPE') {
      parts.push(byType.reduce((sum, t) => sum + Math.min(t.counted, t.required), 0) / req.requiredClasses);
    } else {
      parts.push(input.classes.total / req.requiredClasses);
    }
  }
  if (req.requiredDays > 0) parts.push(elapsedDays / req.requiredDays);
  if (req.requiredSkillIds.length > 0) parts.push((req.requiredSkillIds.length - missingSkillIds.length) / req.requiredSkillIds.length);
  if (req.requiredHours > 0) parts.push(minutesTrained / (req.requiredHours * 60));
  if (req.requiredDaysAttended > 0) parts.push(daysAttended / req.requiredDaysAttended);
  const met = classesOk && daysOk && skillsOk && hoursOk && daysAttendedOk;
  const average = parts.length === 0 ? 100 : Math.min(100, Math.round((parts.reduce((sum, p) => sum + Math.min(1, p), 0) / parts.length) * 100));
  // 100% means every ticked requirement is met (Decision 321 item 7): rounding
  // never shows 100 while one is still short (199 of 200 classes reads 99).
  const progressPercent = met ? average : Math.min(99, average);
  return {
    hasNext: true,
    nextRungId: req.next.id,
    timeOnly: false,
    elapsedDays,
    requiredDays: req.requiredDays,
    requiredClasses: req.requiredClasses,
    countedClasses: input.classes.total,
    byType,
    classesOk,
    daysOk,
    skillsOk,
    requiredHours: req.requiredHours,
    minutesTrained,
    hoursOk,
    requiredDaysAttended: req.requiredDaysAttended,
    daysAttended,
    daysAttendedOk,
    minimumAge: req.minimumAge,
    ageOk,
    waitingForAge: met && !ageOk ? req.minimumAge : null,
    eligible: met && ageOk,
    requiredSkillIds: [...req.requiredSkillIds],
    optionalSkillIds: [],
    missingSkillIds,
    classesPercent,
    progressPercent,
  };
}

/**
 * The student page's progress breakdown (Decisions 301 item 4, 306 item 4,
 * 321): each requirement the style ticks, on its own, next to the overall %.
 * Read straight off the engine's own eligibility, so it can never disagree
 * with the board. A time-only rung has days only. Hours and days attended
 * are listed only in a style that ticks them; minimum age only when the next
 * rung has one.
 */
export interface ProgressBreakdown {
  /** null on a time-only rung, or when the style doesn't tick Classes. */
  classes: { counted: number; required: number; percent: number; byType: TypeProgress[] } | null;
  /** On a time-only rung always; otherwise null when the style doesn't tick Days in rank. */
  days: { elapsed: number; required: number; percent: number } | null;
  /** null on a time-only rung, or when the style doesn't tick Skills. */
  skills: { signedOff: number; required: number; percent: number } | null;
  /** Only in a style that ticks Hours (Decision 321 item 2). */
  hours: { trainedMinutes: number; requiredHours: number; percent: number } | null;
  /** Only in a style that ticks Days attended (Decision 321 item 3). */
  daysAttended: { attended: number; required: number; percent: number } | null;
  /** Only when the next rung has a minimum age the style checks (Decision 321 item 4). */
  minimumAge: { age: number; met: boolean } | null;
}

export function progressBreakdown(eligibility: Eligibility, ticks: { classes: boolean; daysInRank: boolean; skills: boolean; hours: boolean; daysAttended: boolean } = {
  classes: true,
  daysInRank: true,
  skills: true,
  hours: false,
  daysAttended: false,
}): ProgressBreakdown | null {
  if (!eligibility.hasNext) return null;
  const days = { elapsed: eligibility.elapsedDays, required: eligibility.requiredDays, percent: percent(eligibility.elapsedDays, eligibility.requiredDays) };
  const minimumAge = eligibility.minimumAge !== null ? { age: eligibility.minimumAge, met: eligibility.ageOk } : null;
  if (eligibility.timeOnly) return { classes: null, days, skills: null, hours: null, daysAttended: null, minimumAge };
  const requiredSkills = eligibility.requiredSkillIds.length;
  const signedOff = requiredSkills - eligibility.missingSkillIds.length;
  return {
    classes: ticks.classes
      ? { counted: eligibility.countedClasses, required: eligibility.requiredClasses, percent: eligibility.classesPercent, byType: eligibility.byType }
      : null,
    days: ticks.daysInRank ? days : null,
    skills: ticks.skills ? { signedOff, required: requiredSkills, percent: percent(signedOff, requiredSkills) } : null,
    hours: ticks.hours
      ? {
          trainedMinutes: eligibility.minutesTrained,
          requiredHours: eligibility.requiredHours,
          percent: percent(eligibility.minutesTrained, eligibility.requiredHours * 60),
        }
      : null,
    daysAttended: ticks.daysAttended
      ? { attended: eligibility.daysAttended, required: eligibility.requiredDaysAttended, percent: percent(eligibility.daysAttended, eligibility.requiredDaysAttended) }
      : null,
    minimumAge,
  };
}

/** Rounded, capped at 100; nothing required reads as 100 (prototype). */
function percent(done: number, required: number): number {
  return required > 0 ? Math.min(100, Math.round((done / required) * 100)) : 100;
}

export type BoardColumn = 'JUST_STARTING' | 'GETTING_THERE' | 'READY_TO_GRADE';

export interface BoardThresholds {
  gettingThere: number;
  readyToGrade: number;
}

/** Decision 136: 33% / 66% by default, editable per school. */
export const DEFAULT_BOARD_THRESHOLDS: BoardThresholds = { gettingThere: 33, readyToGrade: 66 };

export function boardColumn(progressPercent: number, thresholds: BoardThresholds = DEFAULT_BOARD_THRESHOLDS): BoardColumn {
  if (progressPercent >= thresholds.readyToGrade) return 'READY_TO_GRADE';
  if (progressPercent >= thresholds.gettingThere) return 'GETTING_THERE';
  return 'JUST_STARTING';
}
