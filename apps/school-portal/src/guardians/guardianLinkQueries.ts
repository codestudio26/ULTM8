import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type SchoolGuardianLink = components['schemas']['SchoolGuardianLinkResponseDto'];
export type GuardianLinkConfirmer = components['schemas']['GuardianLinkConfirmerListItemDto'];
export type GuardianLinkStatusFilter = 'pending' | 'confirmed';

/** Decision 172 — Guardian–minor links of this School's students, for the owner to confirm. */
export function useGuardianLinks(schoolId: string | null, status: GuardianLinkStatusFilter) {
  return useQuery({
    queryKey: ['guardianLinks', schoolId, status],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/guardian-links', {
          params: { path: { schoolId: schoolId! }, query: { status } },
        }),
      ),
    enabled: !!schoolId,
  });
}

export function useConfirmGuardianLink(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/guardian-links/{linkId}/confirm', { params: { path: { schoolId, linkId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guardianLinks', schoolId] }),
  });
}

export function useUnconfirmGuardianLink(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/guardian-links/{linkId}/unconfirm', { params: { path: { schoolId, linkId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guardianLinks', schoolId] }),
  });
}

/** Staff the owner has allowed to confirm Guardian links (owner only). */
export function useGuardianLinkConfirmers(schoolId: string | null) {
  return useQuery({
    queryKey: ['guardianLinkConfirmers', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/guardian-link-confirmers', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useAddGuardianLinkConfirmer(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      unwrap(apiClient.PUT('/v1/schools/{schoolId}/guardian-link-confirmers/{userId}', { params: { path: { schoolId, userId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guardianLinkConfirmers', schoolId] }),
  });
}

export function useRemoveGuardianLinkConfirmer(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      unwrap(apiClient.DELETE('/v1/schools/{schoolId}/guardian-link-confirmers/{userId}', { params: { path: { schoolId, userId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guardianLinkConfirmers', schoolId] }),
  });
}
