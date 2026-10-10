import type { RankResponse } from './coachQueries';

/** One stripe of a style's ladder, in the order the API's grading engine uses
 * (belt order, then stripe order). Same shape as the School Portal's ladder.ts. */
export interface Rung {
  id: string;
  rankId: string;
  rank: RankResponse;
  tier: RankResponse['stripeTiers'][number];
  index: number;
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

/** The class types a logged class may be, for the student on `current`: those
 * that count toward the next stripe (the current one when the next is
 * time-only). Empty means any class counts. Mirrors the portal's Log a class. */
export function countingClassTypes(ladder: Rung[], current: Rung): string[] {
  const next = ladder[current.index + 1];
  const src = next && next.tier.timeOnly ? current : next;
  return src?.tier.eligibleClassTypes ?? [];
}
