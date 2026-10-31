import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type Roster = components['schemas']['RosterDto'];

/** Longest roster name (the API's ROSTER_NAME_MAX). */
export const ROSTER_NAME_MAX = 60;

/** Rosters (Decision 317 item 6): named lists of members for staff. */
export function useRosters(schoolId: string | null) {
  return useQuery({
    queryKey: ['rosters', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/rosters', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    retry: false,
  });
}

/** Who's on a roster (the current students the caller covers): the Students
 * list's and roll call's roster filter. */
export function useRosterStudents(schoolId: string | null, rosterId: string | null) {
  return useQuery({
    queryKey: ['rosterStudents', schoolId, rosterId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/rosters/{rosterId}/students', { params: { path: { schoolId: schoolId!, rosterId: rosterId! } } })),
    enabled: !!schoolId && !!rosterId,
    retry: false,
  });
}

/** Any change can change every roster query of the School. */
function useInvalidateRosters(schoolId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['rosters', schoolId] }),
      queryClient.invalidateQueries({ queryKey: ['rosterStudents', schoolId] }),
    ]);
}

export function useCreateRoster(schoolId: string) {
  const invalidate = useInvalidateRosters(schoolId);
  return useMutation({
    mutationFn: (name: string) => unwrap(apiClient.POST('/v1/schools/{schoolId}/rosters', { params: { path: { schoolId } }, body: { name } })),
    onSuccess: invalidate,
  });
}

export function useRenameRoster(schoolId: string) {
  const invalidate = useInvalidateRosters(schoolId);
  return useMutation({
    mutationFn: ({ rosterId, name }: { rosterId: string; name: string }) =>
      unwrap(apiClient.PATCH('/v1/schools/{schoolId}/rosters/{rosterId}', { params: { path: { schoolId, rosterId } }, body: { name } })),
    onSuccess: invalidate,
  });
}

export function useDeleteRoster(schoolId: string) {
  const invalidate = useInvalidateRosters(schoolId);
  return useMutation({
    mutationFn: (rosterId: string) => unwrap(apiClient.DELETE('/v1/schools/{schoolId}/rosters/{rosterId}', { params: { path: { schoolId, rosterId } } })),
    onSuccess: invalidate,
  });
}

export function useAddRosterStudents(schoolId: string, rosterId: string) {
  const invalidate = useInvalidateRosters(schoolId);
  return useMutation({
    mutationFn: (studentIds: string[]) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/rosters/{rosterId}/students', { params: { path: { schoolId, rosterId } }, body: { studentIds } })),
    onSuccess: invalidate,
  });
}

export function useRemoveRosterStudent(schoolId: string, rosterId: string) {
  const invalidate = useInvalidateRosters(schoolId);
  return useMutation({
    mutationFn: (studentId: string) =>
      unwrap(apiClient.DELETE('/v1/schools/{schoolId}/rosters/{rosterId}/students/{studentId}', { params: { path: { schoolId, rosterId, studentId } } })),
    onSuccess: invalidate,
  });
}
