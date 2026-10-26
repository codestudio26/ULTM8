import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type BookingResponse = components['schemas']['BookingResponseDto'];
export type StudentBookingResponse = components['schemas']['StudentBookingResponseDto'];
export type BookClassInput = components['schemas']['BookClassDto'];

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

/** The student page's "Upcoming booking": the soonest booking whose class
 * hasn't started, and how many more (GET /students/{id}/bookings/next,
 * Decision 324). */
export function useNextStudentBooking(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['studentBookings', studentId, schoolId, 'next'],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/students/{id}/bookings/next', {
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
  return useMutation({
    mutationFn: ({ classId, body }: { classId: string; body: BookClassInput }) =>
      unwrap(apiClient.POST('/v1/classes/{id}/book', { params: { path: { id: classId } }, body })),
  });
}
