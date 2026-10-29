import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

/** Unplanned open mat sessions (Decision 386, handover F10). */
export type OpenMatPermission = components['schemas']['OpenMatPermissionDto'];
export type StartOpenMatInput = components['schemas']['StartOpenMatDto'];

/** Whether the caller can start one, and at which Branches (null: any). */
export function useMyOpenMat(schoolId: string | null) {
  return useQuery({
    queryKey: ['openMat', 'me', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/open-mats/me', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useStartOpenMat(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StartOpenMatInput) => unwrap(apiClient.POST('/v1/schools/{schoolId}/open-mats', { params: { path: { schoolId: schoolId! } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['classes', schoolId] }),
  });
}

/** Owner only: who may start one. */
export function useOpenMatPermissions(schoolId: string | null) {
  return useQuery({
    queryKey: ['openMat', 'permissions', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/open-mats/permissions', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useSetOpenMatPermission(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, canStartOpenMat }: { userId: string; canStartOpenMat: boolean }) =>
      unwrap(
        apiClient.PUT('/v1/schools/{schoolId}/open-mats/permissions/{userId}', { params: { path: { schoolId: schoolId!, userId } }, body: { canStartOpenMat } }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['openMat', 'permissions', schoolId] }),
  });
}
