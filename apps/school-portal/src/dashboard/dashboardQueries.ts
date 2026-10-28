import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type BookingsSummaryResponse = components['schemas']['BookingsSummaryResponseDto'];
export type BookingsSummaryDay = components['schemas']['BookingsSummaryDayDto'];
export type BookingsSummaryActivity = components['schemas']['BookingsSummaryActivityDto'];
export type BookingsSummaryClass = components['schemas']['BookingsSummaryClassDto'];

export interface BookingsSummaryRange {
  from: string;
  to: string;
}

/**
 * GET /schools/:schoolId/bookings/summary — v1.2 backend backlog, Dashboard
 * "Bookings This Week" drill-down. `range` omitted asks the API for its own
 * current Mon–Sun week default (BookingsService.getWeeklySummary's own header
 * comment) rather than this hook re-deriving "this week" a second time on the
 * client. `branchId` narrows it to one Branch (Decision 367, Q5).
 *
 * Decision 367 (D7): refreshes when the Owner comes back to the tab and every
 * five minutes, so a Dashboard left open doesn't keep showing the morning's
 * figures.
 */
export function useBookingsSummary(schoolId: string | null, range?: BookingsSummaryRange | null, branchId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['bookings-summary', schoolId, range?.from ?? null, range?.to ?? null, branchId ?? null],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/bookings/summary', {
          params: {
            path: { schoolId: schoolId! },
            query: { from: range?.from, to: range?.to, branchId: branchId || undefined },
          },
        }),
      ),
    enabled: !!schoolId && enabled,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
  });
}
