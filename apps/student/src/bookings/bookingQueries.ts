import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { usePaginatedQuery } from '../lib/usePaginatedQuery';

export function useMyBookings() {
  return usePaginatedQuery(['my-bookings'], (cursor) =>
    unwrap(apiClient.GET('/v1/bookings/me', { params: { query: { cursor } } })),
  );
}

/** Self-booking sends no `studentId`. `studentId` on BookClassDto is the
 * Staff/Guardian book-on-behalf-of field, sent here only for a parent booking their
 * child (Decision 379); `overrideReason` is Staff-only and never sent. `sourceMembershipId` is resolved server-side from the caller's own active
 * Membership (verified in apps/api/src/bookings/bookings.service.ts) — nothing to pick
 * here. Real gates (unsigned waiver, rank ineligibility, class full) surface as
 * ApiError from this call; the caller decides how to display each (see
 * AcademyDetailScreen's ClassBookingRow — class-full gets a "Join waitlist" offer,
 * everything else shows the real message). */
export function useBookClass(studentId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // `guestPassIds` (Waivers Q9): one of the member's own Friend Passes per
    // guest; the API checks each belongs to them and covers this class.
    // `studentId` (Decision 379): a parent booking their child, the Guardian
    // on-behalf-of path; the guests' passes are then the child's.
    mutationFn: ({ classId, guestPassIds = [] }: { classId: string; guestPassIds?: string[] }) =>
      unwrap(
        apiClient.POST('/v1/classes/{id}/book', {
          params: { path: { id: classId } },
          body: { ...(studentId ? { studentId } : {}), ...(guestPassIds.length ? { attendeeMembershipIds: guestPassIds } : {}) },
        }),
      ),
    // Returned (not fire-and-forget) so mutateAsync's caller only resolves once the
    // list has actually been told to refetch — otherwise a screen that awaits the
    // booking and immediately navigates to MyBookingsScreen could still see the
    // pre-booking list for a moment.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: studentId ? ['minor-bookings', studentId] : ['my-bookings'] }),
        queryClient.invalidateQueries({ queryKey: ['friend-passes'] }),
      ]),
  });
}

/** The member's own Friend Passes at a School that can still pay for a guest,
 * or, with `studentId`, their child's (Decision 379). */
export function useMyFriendPasses(schoolId: string | null, studentId?: string) {
  return useQuery({
    queryKey: ['friend-passes', schoolId, studentId ?? null],
    queryFn: () =>
      studentId
        ? unwrap(apiClient.GET('/v1/guardians/me/minors/{studentId}/friend-passes', { params: { path: { studentId }, query: { schoolId: schoolId! } } }))
        : unwrap(apiClient.GET('/v1/schools/{schoolId}/friend-passes/me', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** A booking's guests: each one's signing link and whether they have signed.
 * With `studentId`, a booking of the parent's child (Decision 379). */
export function useBookingGuests(bookingId: string | null, studentId?: string) {
  return useQuery({
    queryKey: ['booking-guests', bookingId],
    queryFn: () =>
      studentId
        ? unwrap(apiClient.GET('/v1/guardians/me/minors/{studentId}/bookings/{id}/guests', { params: { path: { studentId, id: bookingId! } } }))
        : unwrap(apiClient.GET('/v1/bookings/{id}/guests', { params: { path: { id: bookingId! } } })),
    enabled: !!bookingId,
  });
}

/** Decision 379: the Schools a parent's child is a student at, to book a class there. */
export function useMinorSchools(studentId: string) {
  return useQuery({
    queryKey: ['minor-schools', studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/guardians/me/minors/{studentId}/schools', { params: { path: { studentId } } })),
  });
}

/** Decision 379: the child's upcoming bookings, soonest first. */
export function useMinorBookings(studentId: string) {
  return useQuery({
    queryKey: ['minor-bookings', studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/guardians/me/minors/{studentId}/bookings', { params: { path: { studentId } } })),
  });
}

/** Only meaningful for a Booking whose status is UPCOMING (BookingStatus enum:
 * UPCOMING/COMPLETED/CANCELLED/NO_SHOW, apps/api/prisma/schema.prisma) — the caller
 * (MyBookingsScreen) gates the Cancel action on that already. */
export function useCancelBooking(studentId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Self-cancel sends an empty body. `studentId` on CancelBookingDto is the same
    // Staff/Guardian on-behalf-of field as BookClassDto's (see useBookClass above):
    // sent only when a parent cancels their child's booking (Decision 379).
    mutationFn: (bookingId: string) =>
      unwrap(apiClient.PATCH('/v1/bookings/{id}/cancel', { params: { path: { id: bookingId } }, body: studentId ? { studentId } : {} })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studentId ? ['minor-bookings', studentId] : ['my-bookings'] }),
  });
}
