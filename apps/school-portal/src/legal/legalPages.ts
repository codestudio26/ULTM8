import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import type { TranslationKey } from '../i18n/I18nProvider';

/** The legal pages (Decision 440), by their LegalDocument slug. */
export const LEGAL_PAGES = {
  'terms-and-conditions': 'legal.titles.terms',
  'privacy-statement': 'legal.titles.privacy',
  'school-agreement': 'legal.titles.schoolAgreement',
  'children-notice': 'legal.titles.childrenNotice',
  'cookie-notice': 'legal.titles.cookies',
} as const satisfies Record<string, TranslationKey>;

export type LegalSlug = keyof typeof LEGAL_PAGES;

export const isLegalSlug = (slug: string): slug is LegalSlug => slug in LEGAL_PAGES;

export const legalPath = (slug: LegalSlug) => `/legal/${slug}`;

export function useLegalDocument(slug: LegalSlug | null) {
  return useQuery({
    queryKey: ['legal', slug],
    enabled: !!slug,
    queryFn: () => unwrap(apiClient.GET('/v1/legal/{doc}', { params: { path: { doc: slug! } } })),
  });
}
