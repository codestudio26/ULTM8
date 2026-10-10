import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type ClassResponse = components['schemas']['ClassResponseDto'];
export type ClassRosterEntry = components['schemas']['ClassRosterEntryResponseDto'];

/** Resolves School names for the multi-School picker (an Instructor teaching at more
 * than one School, ultm8-domain-rules §3) — mirrors apps/student's
 * useEnrolledSchoolNames (same "useQueries over a dynamic-length id list" need, since
 * the Rules of Hooks forbid calling useSchool in a loop). */
export function useSchoolNames(schoolIds: string[]): Map<string, string> {
  const results = useQueries({
    queries: schoolIds.map((schoolId) => ({
      queryKey: ['school', schoolId],
      queryFn: () => unwrap(apiClient.GET('/v1/schools/{id}', { params: { path: { id: schoolId } } })),
    })),
  });
  return new Map(results.map((r, i) => [schoolIds[i], r.data?.name ?? schoolIds[i]]));
}

/** Today's Classes taught by `instructorId` at `schoolId` — the additive
 * instructorId/startDateFrom/startDateTo filter on GET /schools/{schoolId}/classes
 * (Track B Phase 5), not a client-side filter over the School's whole, randomly
 * id-ordered Class history (see this endpoint's own scoping notes). A generous
 * `limit: 100` is still passed since there's no further filter below "one day, one
 * Instructor" — in practice this is always a small result set. */
export function useTodaysClassesForInstructor(schoolId: string | null, instructorId: string | null) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  return useQuery({
    queryKey: ['checkin-classes', schoolId, instructorId, startOfDay.toDateString()],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/classes', {
          params: {
            path: { schoolId: schoolId! },
            query: {
              instructorId: instructorId!,
              startDateFrom: startOfDay.toISOString(),
              startDateTo: endOfDay.toISOString(),
              limit: 100,
            },
          },
        }),
      ),
    enabled: !!schoolId && !!instructorId,
  });
}

/** GET /classes/{id}/roster — the Instructor roll-call screen's own data (Decision
 * 71's named concept, built as a plain per-Student roster tap rather than a literal
 * QR scan — see AttendanceService's own header comment, apps/api). */
export function useClassRoster(classId: string | null) {
  return useQuery({
    queryKey: ['class-roster', classId],
    queryFn: () => unwrap(apiClient.GET('/v1/classes/{id}/roster', { params: { path: { id: classId! } } })),
    enabled: !!classId,
  });
}

export function useInstructorCheckIn(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) =>
      unwrap(apiClient.POST('/v1/classes/{id}/attendance-scan', { params: { path: { id: classId } }, body: { studentId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['class-roster', classId] }),
  });
}

export function useUndoInstructorCheckIn(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) =>
      unwrap(apiClient.DELETE('/v1/classes/{id}/attendance-scan/{studentId}', { params: { path: { id: classId, studentId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['class-roster', classId] }),
  });
}
