import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import type { TranslationKey } from '../i18n/types';

/** The legal pages (Decision 444), by their LegalDocument slug. */
export const LEGAL_PAGES = {
  'terms-and-conditions': 'legal.titles.terms',
  'privacy-statement': 'legal.titles.privacy',
  'school-agreement': 'legal.titles.schoolAgreement',
  'children-notice': 'legal.titles.childrenNotice',
  'cookie-notice': 'legal.titles.cookies',
} as const satisfies Record<string, TranslationKey>;

export type LegalSlug = keyof typeof LEGAL_PAGES;

/** GET /v1/legal/:slug, open to everyone signed in or not. */
export function useLegalDocument(slug: LegalSlug) {
  return useQuery({
    queryKey: ['legal', slug],
    queryFn: () => unwrap(apiClient.GET('/v1/legal/{doc}', { params: { path: { doc: slug } } })),
  });
}
