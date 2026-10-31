import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type AttendanceStats = components['schemas']['AttendanceStatsResponseDto'];
export type LogClasses = components['schemas']['LogClassesResponseDto'];
export type LogClassItem = components['schemas']['LogClassItemDto'];
export type LoggedAttendance = components['schemas']['LoggedAttendanceResponseDto'];

/** Decision 317 item 3: the last 30 days. The owner sees the whole School,
 * Branch Staff with "See attendance statistics" their own Branches. */
export function useAttendanceStats(schoolId: string | null, filters: { branchId?: string; excludePasses: boolean }, enabled = true) {
  return useQuery({
    queryKey: ['attendance-stats', schoolId, filters.branchId ?? null, filters.excludePasses],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/attendance/stats', {
          params: { path: { schoolId: schoolId! }, query: { branchId: filters.branchId, excludePasses: filters.excludePasses } },
        }),
      ),
    enabled: !!schoolId && enabled,
  });
}

/** Decision 317 item 4: the classes on one day (School time) attendance can be
 * logged for; today, the School's, when `date` is null. */
export function useLogClasses(schoolId: string | null, date: string | null, studentId: string | null) {
  return useQuery({
    queryKey: ['attendance-log-classes', schoolId, date, studentId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/attendance/log-classes', {
          params: { path: { schoolId: schoolId! }, query: { date: date ?? undefined, studentId: studentId ?? undefined } },
        }),
      ),
    enabled: !!schoolId,
    // Keeps the day picker on screen while another day loads.
    placeholderData: (previous) => previous,
  });
}

/** Decision 317 item 4: log a class a student came to. It counts like a
 * check-in, so their bookings, memberships and grading are read again. */
export function useLogAttendance(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { studentId: string; classId: string }) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/attendance/logs', { params: { path: { schoolId } }, body })),
    onSuccess: (_done, { studentId, classId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['attendance-stats', schoolId] }),
        queryClient.invalidateQueries({ queryKey: ['attendance-log-classes', schoolId] }),
        queryClient.invalidateQueries({ queryKey: ['student-grading', studentId] }),
        queryClient.invalidateQueries({ queryKey: ['grading-board'] }),
        queryClient.invalidateQueries({ queryKey: ['studentBookings', studentId] }),
        queryClient.invalidateQueries({ queryKey: ['studentMemberships', schoolId] }),
        queryClient.invalidateQueries({ queryKey: ['classBookings', classId] }),
      ]),
  });
}
