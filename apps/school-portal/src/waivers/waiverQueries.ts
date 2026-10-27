import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type WaiverResponse = components['schemas']['WaiverResponseDto'];
export type CreateWaiverInput = components['schemas']['CreateWaiverDto'];
export type UpdateWaiverInput = components['schemas']['UpdateWaiverDto'];
export type WaiverSignatureResponse = components['schemas']['WaiverSignatureResponseDto'];
export type WaiverSignatureSummary = components['schemas']['WaiverSignatureSummaryDto'];

/** Reads every page, like useBranches. Decision 226 —
 * always fetches `includeArchived: true`, same "fetch everything, filter/
 * toggle client-side" convention useBranches already established. */
export function useWaivers(schoolId: string | null) {
  return useQuery({
    queryKey: ['waivers', schoolId],
    // Every page (Waivers review W8: only the first 20 used to show).
    queryFn: async () => {
      const items: WaiverResponse[] = [];
      let cursor: string | undefined;
      do {
        const page = await unwrap(
          apiClient.GET('/v1/schools/{schoolId}/waivers', { params: { path: { schoolId: schoolId! }, query: { includeArchived: true, limit: 100, cursor } } }),
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return { items };
    },
    enabled: !!schoolId,
  });
}

export function useCreateWaiver(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWaiverInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/waivers', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waivers', schoolId] }),
  });
}

export function useUpdateWaiver(schoolId: string, waiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWaiverInput) =>
      unwrap(apiClient.PATCH('/v1/waivers/{id}', { params: { path: { id: waiverId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waivers', schoolId] }),
  });
}

/** Decision 226 — School Owner/Manager only, idempotent, blocked (409) by
 * ANY WaiverSignature row (signed or unsigned-assignment). Never
 * hard-purged once archived — see WaiverResponseDto's own purgeAt comment. */
export function useArchiveWaiver(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (waiverId: string) => unwrap(apiClient.POST('/v1/waivers/{id}/archive', { params: { path: { id: waiverId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waivers', schoolId] }),
  });
}

export function useUnarchiveWaiver(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (waiverId: string) => unwrap(apiClient.POST('/v1/waivers/{id}/unarchive', { params: { path: { id: waiverId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waivers', schoolId] }),
  });
}

/** v1.2 backend backlog — the "Signatures" panel's real data: who has
 * signed, with what status. Reads every page (Waivers review W8). */
/** One signature with the text as it was signed — the list leaves that out. */
export function useWaiverSignature(schoolId: string, waiverId: string, signatureId: string) {
  return useQuery({
    queryKey: ['waivers', schoolId, waiverId, 'signatures', signatureId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/waivers/{id}/signatures/{signatureId}', {
          params: { path: { schoolId, id: waiverId, signatureId } },
        }),
      ),
  });
}

export function useWaiverSignatures(schoolId: string | null, waiverId: string | null) {
  return useQuery({
    queryKey: ['waivers', schoolId, waiverId, 'signatures'],
    queryFn: async () => {
      const items: WaiverSignatureResponse[] = [];
      let summary: WaiverSignatureSummary | undefined;
      let cursor: string | undefined;
      do {
        const page = await unwrap(
          apiClient.GET('/v1/schools/{schoolId}/waivers/{id}/signatures', {
            params: { path: { schoolId: schoolId!, id: waiverId! }, query: { limit: 100, cursor } },
          }),
        );
        items.push(...page.items);
        summary = page.summary;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return { items, summary };
    },
    enabled: !!schoolId && !!waiverId,
  });
}
