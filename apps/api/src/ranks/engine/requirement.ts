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
 */

export interface CountRules {
  eligibleClassTypes: string[];
  classCountMode: ClassCountMode;
  classTypeRequirements: ClassTypeRequirement[];
  weeklyClassCountCap: number | null;
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
      requiredClasses: number;
      requiredDays: number;
      requiredSkillIds: string[];
      optionalSkillIds: string[];
      countRules: CountRules;
    };

export function requirementFor(ladder: Rung[], currentRungId: string): Requirement {
  const i = rungIndex(ladder, currentRungId);
  if (i < 0) return { kind: 'DATA_ERROR' };
  const current = ladder[i];
  const next = ladder[i + 1];
  if (!next) return { kind: 'TOP', current };

  if (current.timeOnly) {
    return {
      kind: 'NEXT',
      current,
      next,
      timeOnly: true,
      requiredClasses: 0,
      requiredDays: current.minimumDaysInRank,
      requiredSkillIds: [],
      optionalSkillIds: [...next.requiredSkillIds],
      countRules: { eligibleClassTypes: [], classCountMode: 'ANY_TYPE', classTypeRequirements: [], weeklyClassCountCap: null },
    };
  }

  const src = next.timeOnly ? current : next;
  const eachType = src.classCountMode === 'EACH_TYPE';
  return {
    kind: 'NEXT',
    current,
    next,
    timeOnly: false,
    // In EACH_TYPE mode the total is the per-type numbers added up (Decision 149).
    requiredClasses: eachType ? src.classTypeRequirements.reduce((sum, r) => sum + r.classesRequired, 0) : src.classesRequired,
    requiredDays: src.minimumDaysInRank,
    requiredSkillIds: [...src.requiredSkillIds],
    optionalSkillIds: [],
    countRules: {
      eligibleClassTypes: [...src.eligibleClassTypes],
      classCountMode: src.classCountMode,
      classTypeRequirements: src.classTypeRequirements.map((r) => ({ ...r })),
      weeklyClassCountCap: src.weeklyClassCountCap,
    },
  };
}
