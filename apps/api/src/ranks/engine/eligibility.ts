import { ClassTally } from './class-count';
import { daysSince } from './days';
import { Requirement } from './requirement';

/**
 * Grading engine — eligibility and progress (prototype `computeEligibility`,
 * `computeProgress`, `progressBand`; Decisions 127, 136, 149, 171).
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
      eligible: boolean;
      requiredSkillIds: string[];
      optionalSkillIds: string[];
      missingSkillIds: string[];
      /** 0–100. Classes only (days for a time-only rung): skills and minimum
       * days are warnings on the card, never part of the % (Decision 136). */
      progressPercent: number;
    };

export function computeEligibility(req: Requirement, input: StudentProgressInput): Eligibility {
  if (req.kind === 'DATA_ERROR') return { hasNext: false, dataError: true };
  if (req.kind === 'TOP') return { hasNext: false, dataError: false };

  const elapsedDays = daysSince(input.rankDate, input.today);
  const daysOk = elapsedDays >= req.requiredDays;

  if (req.timeOnly) {
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
      eligible: daysOk,
      requiredSkillIds: [],
      optionalSkillIds: [...req.optionalSkillIds],
      missingSkillIds: [],
      progressPercent: percent(elapsedDays, req.requiredDays),
    };
  }

  const signed = new Set(input.signedSkillIds);
  const missingSkillIds = req.requiredSkillIds.filter((id) => !signed.has(id));
  const skillsOk = missingSkillIds.length === 0;

  let classesOk: boolean;
  let byType: TypeProgress[] = [];
  let progressPercent: number;
  if (req.countRules.classCountMode === 'EACH_TYPE') {
    byType = req.countRules.classTypeRequirements.map((r) => ({
      classType: r.classType,
      required: r.classesRequired,
      counted: input.classes.byType[r.classType] ?? 0,
    }));
    classesOk = byType.every((t) => t.counted >= t.required);
    // Combined, each type capped at its own number: 18/20 + 4/10 is 22/30 = 73% (Decision 171).
    const done = byType.reduce((sum, t) => sum + Math.min(t.counted, t.required), 0);
    progressPercent = percent(done, req.requiredClasses);
  } else {
    classesOk = input.classes.total >= req.requiredClasses;
    progressPercent = percent(input.classes.total, req.requiredClasses);
  }

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
    eligible: classesOk && daysOk && skillsOk,
    requiredSkillIds: [...req.requiredSkillIds],
    optionalSkillIds: [],
    missingSkillIds,
    progressPercent,
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
