import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type DeclareStyle = components['schemas']['DeclareStyleOptionDto'];
export type DeclareRung = components['schemas']['DeclareRungDto'];

/** POST /schools/{id}/join, for oneself or (with studentId) a guardian's
 * child. A School with branches needs a home branch (Decisions 139, 168). */
export function useJoinSchool() {
  return useMutation({
    mutationFn: ({ schoolId, studentId, branchId }: { schoolId: string; studentId?: string; branchId?: string }) =>
      unwrap(apiClient.POST('/v1/schools/{id}/join', { params: { path: { id: schoolId } }, body: { studentId, branchId } })),
  });
}

/** The styles a student can still declare a belt in at one School, with each
 * ladder lowest first. Read through the student, so a guardian can use it
 * for their child (Decision 137). */
export function useDeclareOptions(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['declare-options', studentId, schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/students/{id}/ranks/declare-options', { params: { path: { id: studentId! }, query: { schoolId: schoolId! } } })),
    enabled: !!studentId && !!schoolId,
  });
}

/** Declares one belt. Anything above the style's plain first belt waits for
 * the School to verify it (Decision 147). */
export function useDeclareBelt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, disciplineId, rankId, stripeTierId }: { studentId: string; disciplineId: string; rankId: string; stripeTierId: string }) =>
      unwrap(
        apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/declare', {
          params: { path: { id: studentId, disciplineId } },
          body: { rankId, stripeTierId },
        }),
      ),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['declare-options', vars.studentId] });
      void queryClient.invalidateQueries({ queryKey: ['grading-overview', vars.studentId] });
      void queryClient.invalidateQueries({ queryKey: ['student-ranks', vars.studentId] });
    },
  });
}
