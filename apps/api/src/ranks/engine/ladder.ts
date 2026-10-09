/**
 * Grading engine — the ladder (roadmap Phase 2, Decision 126).
 *
 * ULTM8 stores a style's ladder as belts (`Rank`) with ordered stripe tiers
 * (`RankStripeTier`), and every (belt, stripe tier) pair is one rung. The
 * prototype's rules work on one flat list of rungs, so this flattens the two
 * levels into that list. Pure: no database, no clock.
 */

export type ClassCountMode = 'ANY_TYPE' | 'EACH_TYPE';

export interface ClassTypeRequirement {
  classType: string;
  classesRequired: number;
}

/** One rung, with every setting a prototype rung carries (Decision 126). */
export interface Rung {
  /** The stripe tier's id — a student's position is their `currentStripeId`. */
  id: string;
  rankId: string;
  rankOrder: number;
  tierOrder: number;
  name: string;
  /** "Time in rank only" (Decision 128, item 3). */
  timeOnly: boolean;
  classesRequired: number;
  minimumDaysInRank: number;
  /** Which class types count; empty means every class counts (Decision 171). */
  eligibleClassTypes: string[];
  classCountMode: ClassCountMode;
  /** EACH_TYPE only: a number per ticked type (Decision 149). */
  classTypeRequirements: ClassTypeRequirement[];
  /** Null or 0 means no weekly limit (Decision 171). */
  weeklyClassCountCap: number | null;
  requiredSkillIds: string[];
  /** Class types this rung unlocks for booking, for it and every rung above
   * (Decision 173). */
  bookingUnlocksClassTypes: string[];
}

/** The shape the engine reads a belt in. Callers map Prisma rows onto it. */
export interface LadderRank {
  id: string;
  order: number;
  stripeTiers: Array<{
    id: string;
    order: number;
    name: string;
    timeOnly: boolean;
    classesRequired: number | null;
    minimumDaysInRank: number | null;
    eligibleClassTypes: string[];
    classCountMode: ClassCountMode;
    classTypeRequirements: ClassTypeRequirement[];
    weeklyClassCountCap: number | null;
    requiredSkillIds: string[];
    bookingUnlocksClassTypes?: string[];
  }>;
}

/** Belts by `order`, then each belt's tiers by `order`. A missing number reads
 * as 0, as in the prototype (`src.classCount||0`). */
export function flattenLadder(ranks: LadderRank[]): Rung[] {
  return [...ranks]
    .sort((a, b) => a.order - b.order)
    .flatMap((rank) =>
      [...rank.stripeTiers]
        .sort((a, b) => a.order - b.order)
        .map((tier) => ({
          id: tier.id,
          rankId: rank.id,
          rankOrder: rank.order,
          tierOrder: tier.order,
          name: tier.name,
          timeOnly: tier.timeOnly,
          classesRequired: tier.classesRequired ?? 0,
          minimumDaysInRank: tier.minimumDaysInRank ?? 0,
          eligibleClassTypes: [...tier.eligibleClassTypes],
          classCountMode: tier.classCountMode,
          classTypeRequirements: tier.classTypeRequirements.map((r) => ({ ...r })),
          weeklyClassCountCap: tier.weeklyClassCountCap,
          requiredSkillIds: [...tier.requiredSkillIds],
          bookingUnlocksClassTypes: [...(tier.bookingUnlocksClassTypes ?? [])],
        })),
    );
}

export function rungIndex(ladder: Rung[], rungId: string): number {
  return ladder.findIndex((r) => r.id === rungId);
}
