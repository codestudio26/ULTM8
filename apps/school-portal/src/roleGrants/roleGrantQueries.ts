import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type RoleGrantResponse = components['schemas']['RoleGrantResponseDto'];
export type CreateRoleGrantInput = components['schemas']['CreateRoleGrantDto'];
export type InviteCandidateResponse = components['schemas']['InviteCandidateResponseDto'];
export type CreateStaffManuallyInput = components['schemas']['CreateStaffManuallyDto'];
export type CreateStaffManuallyResponse = components['schemas']['CreateStaffManuallyResponseDto'];
export type StaffMember = components['schemas']['StaffMemberDto'];
export type StaffRoleEntry = components['schemas']['StaffRoleDto'];
export type RemoveFromSchoolInput = components['schemas']['RemoveFromSchoolDto'];
export type StaffListFilters = { status: 'active' | 'removed' | 'all'; role?: StaffRoleEntry['role']; branchId?: string; q?: string };

/** One user's grants (GET /users/{userId}/role-grants) — what Instructor and
 * Student Detail use to find the grant to revoke. The Staff page lists
 * everyone through useStaffList() instead (Decision 361). */
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

/** Granting or removing a role changes the Staff page's list (Decision 361)
 * and its "Who can invite coaches" list, which shows every active Branch Staff
 * member (Decision 296: it used to keep showing the old list until a reload). */
function invalidateStaffLists(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['staff-permissions'] }),
    queryClient.invalidateQueries({ queryKey: ['staff'] }),
  ]);
}

/** GET /schools/{schoolId}/staff (Decision 361): everyone with an owner,
 * coach or Branch Staff role here, one row per person, filtered server-side. */
export function useStaffList(schoolId: string | null, filters: StaffListFilters) {
  return useQuery({
    queryKey: ['staff', schoolId, filters],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/staff', {
          params: { path: { schoolId: schoolId! }, query: { ...filters, q: filters.q || undefined } },
        }),
      ),
    enabled: !!schoolId,
    placeholderData: (previous) => previous,
  });
}

/** GET /schools/{schoolId}/staff/{userId}/teaching: the upcoming classes and
 * weekly slots the person still teaches here, which "Remove from School" asks
 * about. Fetched fresh each time the dialog opens. */
export function useStaffTeaching(schoolId: string, userId: string) {
  return useQuery({
    queryKey: ['staff', schoolId, 'teaching', userId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/staff/{userId}/teaching', { params: { path: { schoolId, userId } } })),
    staleTime: 0,
  });
}

/** "Remove from School" (Decision 361): ends every coach and Branch Staff
 * role the person holds here, and gives their classes to another coach,
 * leaves them with no coach, or cancels them (`body`, needed only when they
 * teach). Classes, the timetable and instructors change with it. */
export function useRemoveFromSchool(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body?: RemoveFromSchoolInput }) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/staff/{userId}/remove', { params: { path: { schoolId, userId } }, body: body ?? {} })),
    onSuccess: (_data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['roleGrants', userId] });
      queryClient.invalidateQueries({ queryKey: ['instructors', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['classes', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['class'] });
      queryClient.invalidateQueries({ queryKey: ['timetable', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['openCancellations', schoolId] });
      return invalidateStaffLists(queryClient);
    },
  });
}

/** Decision 370 — the main owner hands the main owner role to a co-owner:
 * re-checks their passcode first (POST /auth/step-up/verify), then hands over
 * with that proof. */
export function useHandOverMainOwner(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, passcode }: { userId: string; passcode: string }) => {
      const { stepUpToken } = await unwrap(apiClient.POST('/v1/auth/step-up/verify', { body: { passcode } }));
      return unwrap(
        apiClient.POST('/v1/schools/{schoolId}/main-owner', {
          params: { path: { schoolId }, header: { 'x-step-up-token': stepUpToken } },
          body: { userId },
        }),
      );
    },
    onSuccess: () => invalidateStaffLists(queryClient),
  });
}

export function useInviteStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ targetUserId, body }: { targetUserId: string; body: CreateRoleGrantInput }) =>
      unwrap(apiClient.POST('/v1/users/{userId}/role-grants', { params: { path: { userId: targetUserId } }, body })),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['roleGrants', variables.targetUserId] });
      invalidateStaffLists(queryClient);
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
      invalidateStaffLists(queryClient);
    },
  });
}

/**
 * POST /schools/{schoolId}/role-grants/add-manually (Decision 251) — Staff "Add
 * Manually": creates a real User + RoleGrant (role: BRANCH_STAFF) immediately from
 * just name+email+branchId; the response's `emailSent` flag is non-blocking, same
 * shape useCreateInstructorManually()'s own InstructorsPage.tsx banner already
 * treats as a warning, not an error. The new person joins "Who can invite
 * coaches", so that list is refreshed (Decision 296).
 */
export function useCreateStaffManually(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStaffManuallyInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/role-grants/add-manually', { params: { path: { schoolId } }, body })),
    onSuccess: () => invalidateStaffLists(queryClient),
  });
}
