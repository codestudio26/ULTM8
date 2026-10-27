import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { ALL_PAGES_LIMIT, fetchAllPages } from '../lib/fetchAllPages';

export type BookingResponse = components['schemas']['BookingResponseDto'];
export type StudentBookingResponse = components['schemas']['StudentBookingResponseDto'];
export type BookClassInput = components['schemas']['BookClassDto'];

/** Read-only — GET /classes/:id/bookings (School Owner/Manager, Branch Staff, or
 * Instructor). Reads every page (Classes review C2: the first 20 only, so a coach
 * couldn't check in the 21st student). Returns `{ items }` like one page did. */
export function useClassBookings(classId: string | null) {
  return useQuery({
    queryKey: ['classBookings', classId],
    queryFn: async () => ({
      items: await fetchAllPages((cursor) =>
        unwrap(apiClient.GET('/v1/classes/{id}/bookings', { params: { path: { id: classId! }, query: { cursor, limit: ALL_PAGES_LIMIT } } })),
      ),
    }),
    enabled: !!classId,
  });
}

/** v1.2 backend backlog — Student Detail's "Upcoming Booking". Read-only —
 * GET /students/:id/bookings (Staff: School Owner/Manager, Branch Staff, or
 * Instructor), `schoolId` a required query param — see
 * BookingsService.findAllForStudent's own header comment. No pagination in
 * this UI yet, same established convention as useClassBookings above. */
export function useStudentBookings(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['studentBookings', studentId, schoolId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/students/{id}/bookings', {
          params: { path: { id: studentId! }, query: { schoolId: schoolId! } },
        }),
      ),
    enabled: !!studentId && !!schoolId,
  });
}

/**
 * Timetable page redesign (click-to-book) — POST /classes/:id/book, the first real
 * caller of this endpoint anywhere in apps/school-portal (confirmed: no existing
 * `useBookClass`/`BookClassDto` usage in this app before this page). Always a
 * Staff-on-behalf-of booking from this screen (`body.studentId` always set, from the
 * dialog's required Student picker) — see BookingsService.bookClass's own header
 * comment for that path's `assertStaffAtSchool` gate. Not building any special
 * handling for the "Student has no Active Membership"/already-booked/etc. error
 * shapes `bookClass()` can throw — they're surfaced via `ApiError.message` in the
 * dialog's own ErrorBanner, same as every other booking entry point in this app
 * (there are none yet besides this one, so there's nothing more specific to match).
 * No cache to invalidate here: this page shows TimetableSlots/occurrences, not a
 * Bookings list — BookingsDrilldownPage/ClassDetailPage's own Bookings views (not
 * reachable from here) are what would show the new row, and they already fetch
 * fresh on their own navigation.
 */
export function useBookClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ classId, body }: { classId: string; body: BookClassInput }) =>
      unwrap(apiClient.POST('/v1/classes/{id}/book', { params: { path: { id: classId } }, body })),
    // The Class page's Add student shows the new row straight away.
    onSuccess: (_booking, { classId }) => queryClient.invalidateQueries({ queryKey: ['classBookings', classId] }),
  });
}

/** Class page "Cancel booking" — PATCH /bookings/:id/cancel by Staff. The
 * School's (or Branch's) cancellation settings decide what goes back, and a
 * refund by anyone but an Owner/Manager waits on the Cancellations page
 * (Decision 291), all server-side. */
export function useCancelBooking(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      unwrap(apiClient.PATCH('/v1/bookings/{id}/cancel', { params: { path: { id: bookingId } }, body: {} })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classBookings', classId] });
      // A freed seat can offer the next waiting student a place.
      queryClient.invalidateQueries({ queryKey: ['classWaitlist', classId] });
      queryClient.invalidateQueries({ queryKey: ['openCancellations'] });
    },
  });
}
