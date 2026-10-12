import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components, paths } from '@ultm8/api-client';
import { apiClient } from '../api';

export type StudentSummary = components['schemas']['StudentSummaryResponseDto'];
export type JoinSchoolInput = components['schemas']['JoinSchoolDto'];
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
