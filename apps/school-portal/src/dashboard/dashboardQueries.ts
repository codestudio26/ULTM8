import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type BookingsSummaryResponse = components['schemas']['BookingsSummaryResponseDto'];
export type BookingsSummaryDay = components['schemas']['BookingsSummaryDayDto'];
export type BookingsSummaryActivity = components['schemas']['BookingsSummaryActivityDto'];

export interface BookingsSummaryRange {
  from: string;
  to: string;
}

/**
 * GET /schools/:schoolId/bookings/summary — v1.2 backend backlog, Dashboard
 * "Bookings This Week" drill-down (the real aggregation backing what was
 * previously the `231`/`22 upcoming` unbacked placeholder figures). `range`
 * omitted asks the API for its own current Mon–Sun week default
 * (BookingsService.getWeeklySummary's own header comment) rather than this hook
 * re-deriving "this week" a second time on the client — DashboardPage's KPI cards
 * rely on that default; BookingsDrilldownPage passes an explicit range once the
 * person picks one.
 */
export function useBookingsSummary(schoolId: string | null, range?: BookingsSummaryRange) {
  return useQuery({
    queryKey: ['bookings-summary', schoolId, range?.from ?? null, range?.to ?? null],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/bookings/summary', {
          params: {
            path: { schoolId: schoolId! },
            query: { from: range?.from, to: range?.to },
          },
        }),
      ),
    enabled: !!schoolId,
  });
}
