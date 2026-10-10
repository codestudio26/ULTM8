import type { RankResponse } from '../ranks/rankQueries';

/** One rung of a style's ladder: a stripe tier of a belt, in ladder order —
 * the same order the API's grading engine uses (belt order, then tier order). */
export interface Rung {
  id: string;
  rankId: string;
  rank: RankResponse;
  tier: RankResponse['stripeTiers'][number];
  index: number;
  /** "Blue Belt 2" style name: the tier's own name, set by the school. */
  name: string;
}

export function flattenLadder(ranks: RankResponse[]): Rung[] {
  const rungs: Rung[] = [];
  for (const rank of [...ranks].sort((a, b) => a.order - b.order)) {
    for (const tier of [...rank.stripeTiers].sort((a, b) => a.order - b.order)) {
      rungs.push({ id: tier.id, rankId: rank.id, rank, tier, index: rungs.length, name: tier.name });
    }
  }
  return rungs;
}

export type StartingClassesShape =
  | { kind: 'NONE' }
  | { kind: 'TOTAL' }
  | { kind: 'BY_TYPE'; classTypes: string[] };

/**
 * What "starting classes" a grade to `to` takes (Decision 128 item 9,
 * Decision 174), mirroring the API's own check: none when the new rung, or the
 * rung its classes are counted toward, is time-only, or there is no rung after
 * it; one number per class type when that rung counts each type separately;
 * otherwise one number.
 */
export function startingClassesFor(ladder: Rung[], to: Rung): StartingClassesShape {
  const after = ladder[to.index + 1];
  if (!after || to.tier.timeOnly) return { kind: 'NONE' };
  const src = after.tier.timeOnly ? to : after;
  if (src.tier.classCountMode === 'EACH_TYPE') {
    const types = (src.tier.classTypeRequirements as Array<{ classType: string }>).map((r) => r.classType);
    return { kind: 'BY_TYPE', classTypes: types };
  }
  return { kind: 'TOTAL' };
}
