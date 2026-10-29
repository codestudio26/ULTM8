import { useMemo } from 'react';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import { useRanks } from '../ranks/rankQueries';
import { flattenLadder, type Rung } from './ladder';

/** Backlog 3.20: a Kids style's linked Adult style and its ladder, for the
 * "Adult program" group in the Grade window. Null unless `enabled` (the
 * student has reached "Ready for Adult from age") and the Adult style is
 * among `styles`. */
export function useAdultProgram(
  kids: DisciplineResponse | null,
  styles: DisciplineResponse[],
  enabled: boolean,
): { discipline: DisciplineResponse; ladder: Rung[] } | null {
  const adult = enabled && kids?.adultDisciplineId ? styles.find((d) => d.id === kids.adultDisciplineId) ?? null : null;
  const ranks = useRanks(adult?.id ?? null);
  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  return adult && ladder.length > 0 ? { discipline: adult, ladder } : null;
}

/** The Kids · Adult pair a style belongs to, if any (Decision 281 item 1). */
export function programPair(style: DisciplineResponse | null, styles: DisciplineResponse[]): { kids: DisciplineResponse; adult: DisciplineResponse } | null {
  if (!style) return null;
  if (style.adultDisciplineId) {
    const adult = styles.find((d) => d.id === style.adultDisciplineId);
    return adult ? { kids: style, adult } : null;
  }
  const kids = styles.find((d) => d.adultDisciplineId === style.id);
  return kids ? { kids, adult: style } : null;
}
