import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type WaiverResponse = components['schemas']['WaiverResponseDto'];
export type CreateWaiverInput = components['schemas']['CreateWaiverDto'];
export type UpdateWaiverInput = components['schemas']['UpdateWaiverDto'];
export type WaiverSignatureResponse = components['schemas']['WaiverSignatureResponseDto'];
export type WaiverSignatureSummary = components['schemas']['WaiverSignatureSummaryDto'];
export type WaiverSettings = components['schemas']['WaiverSettingsDto'];
export type UpdateWaiverSettingsInput = components['schemas']['UpdateWaiverSettingsDto'];

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

/** Decision 226 — School Owner/Manager only, idempotent; always allowed
 * since Decision 354 (signatures stay). Never hard-purged once archived —
 * see WaiverResponseDto's own purgeAt comment. */
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

export type WaiverSignatureFilter = 'signed' | 'unsigned';

/** v1.2 backend backlog — the "Signatures" panel's real data: who has
 * signed, with what status. One page of 100 at a time, A to Z, with "Load
 * more"; the tab and the search run on the server (Decision 418:
 * reading every page first took 22 s at a 3,700-student School). The first
 * page carries the whole roster's totals. */
export function useWaiverSignatures(schoolId: string | null, waiverId: string | null, filters: { filter?: WaiverSignatureFilter; q?: string } = {}) {
  return useInfiniteQuery({
    queryKey: ['waivers', schoolId, waiverId, 'signatures', 'list', filters.filter ?? 'all', filters.q ?? ''],
    queryFn: ({ pageParam }) =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/waivers/{id}/signatures', {
          params: {
            path: { schoolId: schoolId!, id: waiverId! },
            query: { limit: 100, ...(pageParam ? { cursor: pageParam } : {}), ...(filters.filter ? { filter: filters.filter } : {}), ...(filters.q ? { q: filters.q } : {}) },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // A new tab or search keeps the list on screen until its answer arrives.
    placeholderData: keepPreviousData,
    enabled: !!schoolId && !!waiverId,
  });
}

/** Just the totals ("12 of 40 signed"): a one-row page, which still carries them. */
export function useWaiverSignatureSummary(schoolId: string | null, waiverId: string | null) {
  return useQuery({
    queryKey: ['waivers', schoolId, waiverId, 'signatures', 'summary'],
    queryFn: async () =>
      (
        await unwrap(
          apiClient.GET('/v1/schools/{schoolId}/waivers/{id}/signatures', { params: { path: { schoolId: schoolId!, id: waiverId! }, query: { limit: 1 } } }),
        )
      ).summary ?? null,
    enabled: !!schoolId && !!waiverId,
  });
}

/** Waivers → Settings (Decision 354). */
export function useWaiverSettings(schoolId: string | null) {
  return useQuery({
    queryKey: ['waiver-settings', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/waiver-settings', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useUpdateWaiverSettings(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWaiverSettingsInput) =>
      unwrap(apiClient.PATCH('/v1/schools/{schoolId}/waiver-settings', { params: { path: { schoolId } }, body })),
    onSuccess: (data) => queryClient.setQueryData(['waiver-settings', schoolId], data),
  });
}

/** "Remind everyone who hasn't signed" (Decision 354). */
export function useRemindWaiver(schoolId: string, waiverId: string) {
  return useMutation({
    mutationFn: () =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/waivers/{id}/remind', { params: { path: { schoolId, id: waiverId } } })),
  });
}

export const PAPER_PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;

/** Record a waiver signed on paper (Decision 354): upload the photo, then
 * mark the entry signed. */
export function useRecordPaperSignature(schoolId: string, waiverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { signatureId: string; signerFullName: string; signedDate: string; photo: File; uploadFailed: string }) => {
      const path = { schoolId, id: waiverId, signatureId: input.signatureId };
      const contentType = input.photo.type as (typeof PAPER_PHOTO_TYPES)[number];
      const { uploadUrl, objectKey } = await unwrap(
        apiClient.POST('/v1/schools/{schoolId}/waivers/{id}/signatures/{signatureId}/paper-upload-url', { params: { path }, body: { contentType } }),
      );
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: input.photo });
      if (!put.ok) throw new Error(input.uploadFailed);
      return unwrap(
        apiClient.POST('/v1/schools/{schoolId}/waivers/{id}/signatures/{signatureId}/paper', {
          params: { path },
          body: { signerFullName: input.signerFullName, signedDate: input.signedDate, imageKey: objectKey },
        }),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waivers', schoolId, waiverId, 'signatures'] }),
  });
}
