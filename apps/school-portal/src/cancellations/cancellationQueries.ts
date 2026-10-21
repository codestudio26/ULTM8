import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type OpenCancellation = components['schemas']['OpenCancellationResponseDto'];
export type ResolveAction = components['schemas']['ResolveCancellationDto']['action'];

/** Decision 279 — the "to resolve" list (School Owner/Manager or Branch Staff;
 * plan/payment details come back for the Owner/Manager only). */
export function useOpenCancellations(schoolId: string | null) {
  return useQuery({
    queryKey: ['openCancellations', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/cancellations', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useResolveCancellation(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, attendeeId, action }: { bookingId: string; attendeeId: string | null; action: ResolveAction }) =>
      unwrap(
        apiClient.PATCH('/v1/bookings/{id}/resolution', {
          params: { path: { id: bookingId } },
          body: { action, ...(attendeeId ? { attendeeId } : {}) },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['openCancellations', schoolId] });
    },
  });
}

/** Decision 279 — the School cancels a whole class. */
export function useCancelClass(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(apiClient.POST('/v1/classes/{id}/cancel', { params: { path: { id: classId } }, body: reason.trim() ? { reason: reason.trim() } : {} })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class', classId] });
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      queryClient.invalidateQueries({ queryKey: ['classBookings', classId] });
      queryClient.invalidateQueries({ queryKey: ['openCancellations'] });
    },
  });
}
