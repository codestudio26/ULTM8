import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type WaiverResponse = components['schemas']['WaiverResponseDto'];
export type CreateWaiverInput = components['schemas']['CreateWaiverDto'];
export type UpdateWaiverInput = components['schemas']['UpdateWaiverDto'];
export type WaiverSignatureResponse = components['schemas']['WaiverSignatureResponseDto'];

/** No pagination in this UI yet — same established convention as the other
 * list screens (see e.g. useBranches' own header comment). */
export function useWaivers(schoolId: string | null) {
  return useQuery({
    queryKey: ['waivers', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/waivers', { params: { path: { schoolId: schoolId! } } })),
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

/** v1.2 backend backlog — the "Signatures" panel's real data: who HAS
 * signed, with what status. No pagination in this UI yet, same convention
 * as useWaivers above — the backend endpoint itself still paginates
 * (cursor/limit), so a School with a very large signer count would need
 * this revisited, not a gap this hook papers over silently. */
export function useWaiverSignatures(schoolId: string | null, waiverId: string | null) {
  return useQuery({
    queryKey: ['waivers', schoolId, waiverId, 'signatures'],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/waivers/{id}/signatures', {
          params: { path: { schoolId: schoolId!, id: waiverId! } },
        }),
      ),
    enabled: !!schoolId && !!waiverId,
  });
}
