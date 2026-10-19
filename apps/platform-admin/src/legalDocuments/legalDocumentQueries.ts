import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type LegalDocumentResponse = components['schemas']['LegalDocumentResponseDto'];
export type PublishLegalDocumentInput = components['schemas']['PublishLegalDocumentDto'];

/** The documents seeded by the settings migration (20260910000000). The API has no
 * list endpoint, and publishing only ever adds versions to these. */
export const LEGAL_DOCUMENT_SLUGS = [
  { slug: 'privacy-statement', label: 'Privacy notice (Guardian consent refers to this)' },
  { slug: 'terms-and-conditions', label: 'Terms and conditions' },
] as const;

/** Reads the public GET /legal/{doc}: the current text and version. */
export function useLegalDocument(slug: string) {
  return useQuery({
    queryKey: ['legalDocument', slug],
    queryFn: () => unwrap(apiClient.GET('/v1/legal/{doc}', { params: { path: { doc: slug } } })),
  });
}

/** Decision 171 — FULL_ADMIN only, audit-logged; every publish is a new version. */
export function usePublishLegalDocument(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PublishLegalDocumentInput) =>
      unwrap(apiClient.POST('/v1/platform-admin/legal-documents/{slug}/versions', { params: { path: { slug } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['legalDocument', slug] }),
  });
}
