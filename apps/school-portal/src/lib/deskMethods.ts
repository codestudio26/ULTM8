import { useSchool } from '../schools/schoolQueries';

/**
 * Decision 448 item 5 (after Decision 431, MON-13): Pix is a Brazilian scheme
 * and exists only at a School in Brazil (its address country BR). Pricing in
 * reais alone no longer counts. Outside Brazil it is shown nowhere: not in the
 * desk's payment-method lists, nor in the Transactions page's method filter,
 * and the API refuses a Pix payment there. A past Pix row still shows its
 * method.
 */
export function offersPix(school: { addressCountry?: string | null } | null | undefined): boolean {
  return school?.addressCountry?.toUpperCase() === 'BR';
}

/** The methods to offer: Pix left out unless `pix` (offersPix()). */
export function deskMethodsFor<T extends string>(methods: readonly T[], pix: boolean): T[] {
  return pix ? [...methods] : methods.filter((m) => m !== 'PIX');
}

/** Whether a School the page knows only by id offers Pix. While the School
 * is still loading, it doesn't. */
export function useOffersPix(schoolId: string | null): boolean {
  const { data: school } = useSchool(schoolId);
  return offersPix(school);
}

/** deskMethodsFor() for a School the page knows only by id. */
export function useDeskMethods<T extends string>(schoolId: string | null, methods: readonly T[]): T[] {
  return deskMethodsFor(methods, useOffersPix(schoolId));
}
