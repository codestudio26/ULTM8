import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components, paths } from '@ultm8/api-client';
import { apiClient } from '../api';

export type StudentSummary = components['schemas']['StudentSummaryResponseDto'];
export type JoinSchoolInput = components['schemas']['JoinSchoolDto'];
export type UpdateStudentProfileInput = components['schemas']['UpdateStudentProfileDto'];
export type StudentProfileResponse = components['schemas']['StudentProfileResponseDto'];
export type StudentLeavingSummary = components['schemas']['StudentLeavingSummaryResponseDto'];
// GET /schools/:id/students' query params are inlined onto the operation by
// NestJS Swagger (a query DTO's own properties, not a referenced schema component
// — confirmed by grepping the generated schema.d.ts for a few other query DTOs,
// e.g. TranslationsQueryDto, and finding the same: no `components['schemas'][...]`
// entry for any of them), so this type comes from `paths`, not `components`.
type StudentsListQuery = NonNullable<paths['/v1/schools/{id}/students']['get']['parameters']['query']>;
export type StudentRosterStatus = StudentsListQuery['status'];

/** The Student roster — Users holding a STUDENT RoleGrant at this School. No
 * pagination in this UI yet, matching this codebase's own established convention
 * for small/bounded rosters (see useInstructors/useBranches).
 *
 * `status` — additive, optional server-side filter (Students page's Active/
 * Inactive/All filter, GET /schools/:id/students?status=). Omitted, it defaults to
 * ACTIVE server-side — the exact pre-existing behavior (v1.2 backend backlog,
 * "Students page" Active/Inactive gap: the roster previously hard-coded
 * `revokedAt: null`, with no way to ever see a revoked enrollment). */
export function useStudents(schoolId: string | null, status?: StudentRosterStatus) {
  return useQuery({
    queryKey: ['students', schoolId, status ?? null],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{id}/students', { params: { path: { id: schoolId! }, query: { status } } })),
    enabled: !!schoolId,
  });
}

/**
 * "Invite a Student" (v1.2 backend backlog) — School Owner/Manager staff
 * enrolling an existing-but-unenrolled person at their own School. Reuses
 * `POST /schools/{id}/join` (SchoolsService.join()'s own Staff-on-behalf-of
 * branch, mirroring the pre-existing Guardian-on-behalf-of one) rather than
 * a new endpoint — the invite target must already hold a ULTM8 account,
 * found first via `fetchInviteCandidate` (same lookup StaffPage's Instructor/
 * Branch Staff invite flow already uses), so this is the confirm step only.
 */
export function useInviteStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ schoolId, body }: { schoolId: string; body: JoinSchoolInput }) =>
      unwrap(apiClient.POST('/v1/schools/{id}/join', { params: { path: { id: schoolId } }, body })),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['students', variables.schoolId] });
    },
  });
}

/** One Student's full profile, for the staff edit form (GET
 * /schools/{id}/students/{studentId}/profile, Decision 341): the form opens
 * filled in, so emptying a field can really clear it. */
export function useStudentProfile(schoolId: string | null, studentId: string | null) {
  return useQuery({
    queryKey: ['studentProfile', schoolId, studentId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{id}/students/{studentId}/profile', {
          params: { path: { id: schoolId!, studentId: studentId! } },
        }),
      ),
    enabled: !!schoolId && !!studentId,
  });
}

/** What revoking this Student will cancel, and the memberships it leaves
 * running (GET /schools/{id}/students/{studentId}/leaving-summary, Decision
 * 343) — read when the owner opens the Revoke dialog. */
export function useStudentLeavingSummary(schoolId: string | null, studentId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['studentLeavingSummary', schoolId, studentId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{id}/students/{studentId}/leaving-summary', {
          params: { path: { id: schoolId!, studentId: studentId! } },
        }),
      ),
    enabled: enabled && !!schoolId && !!studentId,
    staleTime: 0,
  });
}

/**
 * v1.2 backend backlog — Student Detail "Edit" gap: a Staff member editing a
 * Student's own profile on their behalf (`PATCH /schools/{id}/students/{studentId}/profile`,
 * SchoolsController.updateStudentProfile). Invalidates `['students', schoolId]`
 * (the roster — StudentsPage and this page's own `useStudents` call both key off
 * it, so a renamed Student shows up to date immediately everywhere) rather than
 * patching the cache in place, same convention useRevokeRoleGrant above already
 * uses for its own invalidation.
 */
export function useUpdateStudentProfile(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, body }: { studentId: string; body: UpdateStudentProfileInput }) =>
      unwrap(
        apiClient.PATCH('/v1/schools/{id}/students/{studentId}/profile', {
          params: { path: { id: schoolId!, studentId } },
          body,
        }),
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['students', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['studentProfile', schoolId, variables.studentId] });
    },
  });
}

export type AddStudentManuallyInput = components['schemas']['CreateStudentManuallyDto'];

/** Add manually (Decision 371, Students Q1): the owner creates an adult's
 * account and enrols them; they're emailed a temporary passcode
 * (POST /schools/{schoolId}/students/add-manually). */
export function useAddStudentManually(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddStudentManuallyInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/students/add-manually', { params: { path: { schoolId: schoolId! } }, body })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', schoolId] });
    },
  });
}

/** A student's active Guardians, by name, for the student's page
 * (GET /schools/{id}/students/{studentId}/guardians, Decision 371). */
export function useStudentGuardians(schoolId: string | null, studentId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['studentGuardians', schoolId, studentId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{id}/students/{studentId}/guardians', {
          params: { path: { id: schoolId!, studentId: studentId! } },
        }),
      ),
    enabled: enabled && !!schoolId && !!studentId,
  });
}
