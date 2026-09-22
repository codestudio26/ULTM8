import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { usePaginatedQuery } from '../lib/usePaginatedQuery';

export function useMyBookings() {
  return usePaginatedQuery(['my-bookings'], (cursor) =>
    unwrap(apiClient.GET('/v1/bookings/me', { params: { query: { cursor } } })),
  );
}

/** Self-booking only — an empty body. `studentId`/`overrideReason` on BookClassDto are
 * Staff-only fields (book-on-behalf-of / bypass-a-gate); a Student must never send
 * them. `sourceMembershipId` is resolved server-side from the caller's own active
 * Membership (verified in apps/api/src/bookings/bookings.service.ts) — nothing to pick
 * here. Real gates (unsigned waiver, rank ineligibility, class full) surface as
 * ApiError from this call; the caller decides how to display each (see
 * AcademyDetailScreen's ClassBookingRow — class-full gets a "Join waitlist" offer,
 * everything else shows the real message). */
export function useBookClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (classId: string) => unwrap(apiClient.POST('/v1/classes/{id}/book', { params: { path: { id: classId } }, body: {} })),
    // Returned (not fire-and-forget) so mutateAsync's caller only resolves once the
    // list has actually been told to refetch — otherwise a screen that awaits the
    // booking and immediately navigates to MyBookingsScreen could still see the
    // pre-booking list for a moment.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-bookings'] }),
  });
}

/** Only meaningful for a Booking whose status is UPCOMING (BookingStatus enum:
 * UPCOMING/COMPLETED/CANCELLED/NO_SHOW, apps/api/prisma/schema.prisma) — the caller
 * (MyBookingsScreen) gates the Cancel action on that already. */
export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => unwrap(apiClient.PATCH('/v1/bookings/{id}/cancel', { params: { path: { id: bookingId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-bookings'] }),
  });
}
