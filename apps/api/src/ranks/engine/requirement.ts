import { ClassCountMode, ClassTypeRequirement, Rung, rungIndex } from './ladder';

/**
 * Grading engine — what a student must do to earn their NEXT rung. One answer,
 * used by eligibility, the progress %, the skills panel and the grading
 * warning, so they can never disagree (prototype `gradingRequirement`,
 * Decision 127):
 *
 * | Student is at…   | …next rung is…   | Requirements come from                   |
 * |------------------|------------------|------------------------------------------|
 * | a normal rung    | a normal rung    | the NEXT rung                            |
 * | a normal rung    | a time-only rung | the CURRENT rung                         |
 * | a time-only rung | anything         | the CURRENT rung's days; next rung's     |
 * |                  |                  | skills shown but optional                |
 *
 * Which classes count, the count mode and the weekly cap come from the same
 * rung as the class number, since they qualify that number.
 *
 * Requirement tick boxes (Decision 321 item 1): each style ticks which
 * requirements it uses. An unticked requirement is not checked, even if a rung
 * still holds a number for it, so it reads here as "not asked" (0, no
 * skills). Hours and days attended come from the same rung as the classes.
 * Minimum age is always the NEXT rung's own (Decision 321 item 4: the age on
 * the day the student is promoted into it). A time-only current rung still
 * counts its days whatever the ticks (item 7), and asks nothing else but the
 * age.
 */

export interface CountRules {
  eligibleClassTypes: string[];
  classCountMode: ClassCountMode;
  classTypeRequirements: ClassTypeRequirement[];
  weeklyClassCountCap: number | null;
}

/** Which requirements a style uses (Decision 321 item 1). */
export interface RequirementTicks {
  classes: boolean;
  daysInRank: boolean;
  skills: boolean;
  hours: boolean;
  daysAttended: boolean;
  minimumAge: boolean;
}

/** What every style did before the tick boxes: classes, days in rank and
 * skills; the three new requirements unticked. A style's own ticks default to
 * this too (see Discipline in schema.prisma). */
export const DEFAULT_TICKS: RequirementTicks = { classes: true, daysInRank: true, skills: true, hours: false, daysAttended: false, minimumAge: false };

/** A style's ticks, from its Discipline row. */
export function ticksOf(d: {
  requireClasses: boolean;
  requireDaysInRank: boolean;
  requireSkills: boolean;
  requireHours: boolean;
  requireDaysAttended: boolean;
  requireMinimumAge: boolean;
}): RequirementTicks {
  return {
    classes: d.requireClasses,
    daysInRank: d.requireDaysInRank,
    skills: d.requireSkills,
    hours: d.requireHours,
    daysAttended: d.requireDaysAttended,
    minimumAge: d.requireMinimumAge,
  };
}

export type Requirement =
  /** The student's rung isn't on the ladder (bad data) — not the same as the top. */
  | { kind: 'DATA_ERROR' }
  | { kind: 'TOP'; current: Rung }
  | {
      kind: 'NEXT';
      current: Rung;
      next: Rung;
      /** The CURRENT rung is time-only: days only, classes not counted. */
      timeOnly: boolean;
      /** 0 when the style doesn't tick Classes. */
      requiredClasses: number;
      requiredDays: number;
      requiredSkillIds: string[];
      optionalSkillIds: string[];
      /** 0 when the style doesn't tick Hours. */
      requiredHours: number;
      /** 0 when the style doesn't tick Days attended. */
      requiredDaysAttended: number;
      /** Null when the style doesn't tick Minimum age, or the next rung has none. */
      minimumAge: number | null;
      ticks: RequirementTicks;
      countRules: CountRules;
    };

export function requirementFor(ladder: Rung[], currentRungId: string, ticks: RequirementTicks = DEFAULT_TICKS): Requirement {
  const i = rungIndex(ladder, currentRungId);
  if (i < 0) return { kind: 'DATA_ERROR' };
  const current = ladder[i];
  const next = ladder[i + 1];
  if (!next) return { kind: 'TOP', current };
  const minimumAge = ticks.minimumAge && next.minimumAge !== null && next.minimumAge > 0 ? next.minimumAge : null;

  if (current.timeOnly) {
    return {
      kind: 'NEXT',
      current,
      next,
      timeOnly: true,
      requiredClasses: 0,
      requiredDays: current.minimumDaysInRank,
      requiredSkillIds: [],
      optionalSkillIds: ticks.skills ? [...next.requiredSkillIds] : [],
      requiredHours: 0,
      requiredDaysAttended: 0,
      minimumAge,
      ticks,
      countRules: { eligibleClassTypes: [], classCountMode: 'ANY_TYPE', classTypeRequirements: [], weeklyClassCountCap: null },
    };
  }

  const src = next.timeOnly ? current : next;
  const eachType = src.classCountMode === 'EACH_TYPE';
  // In EACH_TYPE mode the total is the per-type numbers added up (Decision 149).
  const classes = eachType ? src.classTypeRequirements.reduce((sum, r) => sum + r.classesRequired, 0) : src.classesRequired;
  return {
    kind: 'NEXT',
    current,
    next,
    timeOnly: false,
    requiredClasses: ticks.classes ? classes : 0,
    requiredDays: ticks.daysInRank ? src.minimumDaysInRank : 0,
    requiredSkillIds: ticks.skills ? [...src.requiredSkillIds] : [],
    optionalSkillIds: [],
    requiredHours: ticks.hours ? src.hoursRequired : 0,
    requiredDaysAttended: ticks.daysAttended ? src.daysAttendedRequired : 0,
    minimumAge,
    ticks,
    countRules: {
      eligibleClassTypes: [...src.eligibleClassTypes],
      classCountMode: src.classCountMode,
      classTypeRequirements: src.classTypeRequirements.map((r) => ({ ...r })),
      weeklyClassCountCap: src.weeklyClassCountCap,
    },
  };
}
