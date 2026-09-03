import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type RoleGrantResponse = components['schemas']['RoleGrantResponseDto'];
export type CreateRoleGrantInput = components['schemas']['CreateRoleGrantDto'];

/**
 * There is no "list all RoleGrants at my School" endpoint — Phase 2 built
 * GET /users/{userId}/role-grants only, scoped to one target user at a time (per
 * ultm8-nestjs-module §5's TenantsModule row; not something Phase 3 adds to, per its
 * own "apps/school-portal only" scope). A full staff roster would need a new backend
 * endpoint — flagged in the Phase 3 summary rather than worked around client-side or
 * added unasked. What IS built: invite by a known User.id, and look up/revoke a
 * specific known user's grants at your School one user at a time.
 */
export function fetchUserRoleGrants(userId: string) {
  return unwrap(apiClient.GET('/v1/users/{userId}/role-grants', { params: { path: { userId } } }));
}

export function useInviteStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ targetUserId, body }: { targetUserId: string; body: CreateRoleGrantInput }) =>
      unwrap(apiClient.POST('/v1/users/{userId}/role-grants', { params: { path: { userId: targetUserId } }, body })),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['roleGrants', variables.targetUserId] });
    },
  });
}

export function useRevokeRoleGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ targetUserId, roleGrantId }: { targetUserId: string; roleGrantId: string }) =>
      unwrap(
        apiClient.DELETE('/v1/users/{userId}/role-grants/{roleGrantId}', {
          params: { path: { userId: targetUserId, roleGrantId } },
        }),
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['roleGrants', variables.targetUserId] });
    },
  });
}
