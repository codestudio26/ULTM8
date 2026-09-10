import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type BookingResponse = components['schemas']['BookingResponseDto'];

/** Read-only — GET /classes/:id/bookings (School Owner/Manager, Branch Staff, or
 * Instructor). FOUND ON REVIEW: this endpoint never existed before this phase —
 * see BookingsService.findAllForClass's own header comment. No pagination in
 * this UI yet, same established convention as the other list screens. */
export function useClassBookings(classId: string | null) {
  return useQuery({
    queryKey: ['classBookings', classId],
    queryFn: () => unwrap(apiClient.GET('/v1/classes/{id}/bookings', { params: { path: { id: classId! } } })),
    enabled: !!classId,
  });
}
