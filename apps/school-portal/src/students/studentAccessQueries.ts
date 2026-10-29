import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type AddChildManuallyInput = components['schemas']['AddChildManuallyDto'];
export type ChildInvite = components['schemas']['ChildInviteDto'];

/** Decision 403: the owner adds a child and names their Guardian. A new
 * Guardian gets a temporary passcode; one with an account gets an invite. */
export function useAddChildManually(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddChildManuallyInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/students/add-child-manually', { params: { path: { schoolId: schoolId! } }, body })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['childInvites', schoolId] });
    },
  });
}

/** Children waiting for their Guardian to accept in the app. Owner only. */
export function useChildInvites(schoolId: string | null) {
  return useQuery({
    queryKey: ['childInvites', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/child-invites', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useWithdrawChildInvite(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST('/v1/schools/{schoolId}/child-invites/{id}/withdraw', { params: { path: { schoolId: schoolId!, id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['childInvites', schoolId] }),
  });
}

/** Whether the owner can make a new temporary passcode for this student, or
 * for a child their Guardian. */
export function useTemporaryPasscodeStatus(schoolId: string, studentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['temporaryPasscode', schoolId, studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/temporary-passcode', { params: { path: { schoolId, studentId } } })),
    enabled,
  });
}

export function useNewTemporaryPasscode(schoolId: string, studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/schools/{schoolId}/students/{studentId}/temporary-passcode', { params: { path: { schoolId, studentId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['temporaryPasscode', schoolId, studentId] }),
  });
}
