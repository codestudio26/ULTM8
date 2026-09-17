import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** GET /students/{id}/ranks requires schoolId (a Student's StudentRank rows are
 * School-scoped) and takes no cursor/limit — StudentRankListResponseDto has no
 * nextCursor, a StudentRank row exists per-Discipline-trained, a small bounded set,
 * not an unbounded log (verified in apps/api/src/ranks/grading.controller.ts's own
 * comment). `id` is the caller's own User.id for a Student viewing their own ranks
 * (GradingService.assertCallerCanReadStudent: `if (callerId === studentId) return`). */
export function useStudentRanks(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['student-ranks', studentId, schoolId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/students/{id}/ranks', {
          params: { path: { id: studentId! }, query: { schoolId: schoolId! } },
        }),
      ),
    enabled: !!studentId && !!schoolId,
  });
}

/** Discipline names for a School — confirmed a Student can read these: no
 * assertStaffAtSchool gate in RanksService.findAllDisciplines, and the table's own
 * RLS policy (discipline_tenant_isolation) admits any active RoleGrant at the School,
 * not staff-only (apps/api/prisma/migrations/20260914000000_ranks_module/migration.sql). */
export function useDisciplines(schoolId: string | null) {
  return useQuery({
    queryKey: ['disciplines', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/disciplines', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** A Rank has no name/title field — it's represented by `order` (a number),
 * `primaryColour`/`secondaryColour` (belt colours), and `stripeTiers` (verified in
 * packages/api-client/src/generated/schema.d.ts's RankResponseDto). Same RLS shape as
 * Discipline (catalog data, any active RoleGrant at the School can read it). */
export function useRank(rankId: string | null) {
  return useQuery({
    queryKey: ['rank', rankId],
    queryFn: () => unwrap(apiClient.GET('/v1/ranks/{id}', { params: { path: { id: rankId! } } })),
    enabled: !!rankId,
  });
}
