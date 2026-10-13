import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type RoleGrantResponse = components['schemas']['RoleGrantResponseDto'];
export type CreateRoleGrantInput = components['schemas']['CreateRoleGrantDto'];
export type InviteCandidateResponse = components['schemas']['InviteCandidateResponseDto'];
export type CreateStaffManuallyInput = components['schemas']['CreateStaffManuallyDto'];
export type CreateStaffManuallyResponse = components['schemas']['CreateStaffManuallyResponseDto'];

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

/**
 * Exact email/phone match only, never a name search (Decision 116) — the invite
 * target has no RoleGrant at this School yet, so fetchUserRoleGrants' own lookup
 * (which relies on a shared RoleGrant already existing) can't find them. Called
 * imperatively from StaffPage's "Find" step, same convention as fetchUserRoleGrants
 * itself, not a react-query hook — this is a one-shot lookup, not cached reference
 * data.
 */
export function fetchInviteCandidate(schoolId: string, query: { email?: string; phone?: string }) {
  return unwrap(
    apiClient.GET('/v1/schools/{schoolId}/role-grants/invite-candidate', {
      params: { path: { schoolId }, query },
    }),
  );
}

/**
 * v1.2 backend backlog — Instructor Detail's/Student Detail's "Revoke
 * Enrollment" action needs to know, on page load (not only on a manual
 * lookup form submit the way StaffPage's own imperative fetchUserRoleGrants
 * call is used), which active RoleGrant to actually revoke — a cached
 * react-query wrapper over the same endpoint, additive alongside the
 * existing imperative helper rather than replacing it.
 */
export function useUserRoleGrants(userId: string | null) {
  return useQuery({
    queryKey: ['roleGrants', userId],
    queryFn: () => fetchUserRoleGrants(userId!),
    enabled: !!userId,
  });
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

/**
 * POST /schools/{schoolId}/role-grants/add-manually (Decision 251) — Staff "Add
 * Manually": creates a real User + RoleGrant (role: BRANCH_STAFF) immediately from
 * just name+email+branchId; the response's `emailSent` flag is non-blocking, same
 * shape useCreateInstructorManually()'s own InstructorsPage.tsx banner already
 * treats as a warning, not an error. No query key to invalidate here the way
 * useCreateInstructorManually() invalidates `['instructors', schoolId]` — there is
 * no "list my School's staff" query this result would need to refresh (see this
 * file's own header comment on fetchUserRoleGrants' one-user-at-a-time scope).
 */
export function useCreateStaffManually(schoolId: string) {
  return useMutation({
    mutationFn: (body: CreateStaffManuallyInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/role-grants/add-manually', { params: { path: { schoolId } }, body })),
  });
}
