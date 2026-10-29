import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type CoachInvite = components['schemas']['CoachInviteResponseDto'];
export type CreatedCoachInvite = components['schemas']['CreatedCoachInviteResponseDto'];
export type StaffPermission = components['schemas']['StaffPermissionResponseDto'];

/** Coach invites (Decision 183): the owner sees all of them. */
export function useCoachInvites(schoolId: string | null) {
  return useQuery({
    queryKey: ['coach-invites', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/coach-invites', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useSendCoachInvite(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; branchId?: string; role?: 'INSTRUCTOR' | 'BRANCH_STAFF' }) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/coach-invites', { params: { path: { schoolId } }, body })) as Promise<CreatedCoachInvite>,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coach-invites', schoolId] }),
  });
}

export function useCancelCoachInvite(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => unwrap(apiClient.POST('/v1/coach-invites/{id}/cancel', { params: { path: { id: inviteId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coach-invites', schoolId] }),
  });
}

/** Branch Staff and their two switches, "Can invite coaches" and "Can manage
 * disciplines" (Decision 383). Owner only. */
export function useStaffPermissions(schoolId: string | null) {
  return useQuery({
    queryKey: ['staff-permissions', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/staff-permissions', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export type StaffSwitch = 'canInviteCoaches' | 'canManageDisciplines';

/** Turns one switch on or off; the other keeps its value. */
export function useSetStaffPermission(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, field, on }: { userId: string; field: StaffSwitch; on: boolean }) =>
      unwrap(
        apiClient.PUT('/v1/schools/{schoolId}/staff-permissions/{userId}', { params: { path: { schoolId, userId } }, body: { [field]: on } }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff-permissions', schoolId] });
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

/** The caller's own rights (Decision 184): owner, or Branch Staff with
 * "Can invite coaches" for their own branches, and "Can manage disciplines"
 * (Decision 383). */
export function useMyStaffPermission(schoolId: string | null) {
  return useQuery({
    queryKey: ['staff-permissions', 'me', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/staff-permissions/me', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** The invite link's page: works before sign-in. */
export function useCoachInviteLink(token: string) {
  return useQuery({
    queryKey: ['coach-invite-link', token],
    queryFn: () => unwrap(apiClient.GET('/v1/coach-invite-links/{token}', { params: { path: { token } } })),
    retry: false,
  });
}

export function useAcceptCoachInvite(token: string) {
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/coach-invite-links/{token}/accept', { params: { path: { token } } })),
  });
}
