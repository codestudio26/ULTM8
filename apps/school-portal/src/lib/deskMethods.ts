import { useSchool } from '../schools/schoolQueries';

/**
 * Decision 430 (stress test round 5 MON-13): Pix is a Brazilian scheme, so the
 * desk's payment-method lists offer it only to a School in Brazil (its address
 * country BR) or one that prices in reais (BRL). The API still accepts it from
 * any School (Decision 348 is unchanged); this only tidies what the portal
 * offers. Filters on past payments still list Pix, so old rows can be found.
 */
export function offersPix(school: { addressCountry?: string | null; defaultCurrency?: string | null } | null | undefined): boolean {
  if (!school) return false;
  return school.addressCountry?.toUpperCase() === 'BR' || school.defaultCurrency?.toUpperCase() === 'BRL';
}

/** The desk methods to offer: Pix left out unless offersPix(). */
export function deskMethodsFor<T extends string>(methods: readonly T[], school: Parameters<typeof offersPix>[0]): T[] {
  return offersPix(school) ? [...methods] : methods.filter((m) => m !== 'PIX');
}

/** deskMethodsFor() for a School the page knows only by id. While the School
 * is still loading, Pix is left out. */
export function useDeskMethods<T extends string>(schoolId: string | null, methods: readonly T[]): T[] {
  const { data: school } = useSchool(schoolId);
  return deskMethodsFor(methods, school);
}
