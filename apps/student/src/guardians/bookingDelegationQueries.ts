import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** GET /guardians/me/booking-delegation (Decision 123) — every BookingDelegation
 * this Guardian has ever granted, across all linked minors. Not paginated,
 * same reasoning as useMyConsentRecords(). */
export function useMyBookingDelegations() {
  return useQuery({
    queryKey: ['my-booking-delegations'],
    queryFn: () => unwrap(apiClient.GET('/v1/guardians/me/booking-delegation', {})),
  });
}

/** POST /guardians/me/minors/{studentId}/booking-delegation — upserts
 * server-side (GuardiansService.grantBookingDelegation's own comment), so
 * re-granting after a withdrawal reactivates the same record rather than
 * erroring. */
export function useGrantBookingDelegation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) =>
      unwrap(apiClient.POST('/v1/guardians/me/minors/{studentId}/booking-delegation', { params: { path: { studentId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-booking-delegations'] }),
  });
}

/** PATCH /guardians/me/booking-delegation/{id}/withdraw. Per Decision 123, this
 * neither keeps nor auto-cancels any Booking the minor already made via Kid
 * Mode — it flags them pendingGuardianReview, which usePendingReviewBookings()
 * below surfaces. */
export function useWithdrawBookingDelegation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (delegationId: string) =>
      unwrap(apiClient.PATCH('/v1/guardians/me/booking-delegation/{id}/withdraw', { params: { path: { id: delegationId } } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-booking-delegations'] });
      queryClient.invalidateQueries({ queryKey: ['pending-review-bookings'] });
    },
  });
}

/** POST /guardians/me/minors/{studentId}/kid-mode-token — mints the short-lived,
 * narrowly-scoped token Kid Mode's booking screen uses for its one allowed
 * call (POST /classes/:id/book). Deliberately a plain mutation, not cached by
 * react-query — a fresh mint is wanted every time Kid Mode is entered, never a
 * stale one replayed from cache. */
export function useMintKidModeToken() {
  return useMutation({
    mutationFn: (studentId: string) =>
      unwrap(apiClient.POST('/v1/guardians/me/minors/{studentId}/kid-mode-token', { params: { path: { studentId } } })),
  });
}

/** GET /guardians/me/bookings-pending-review (Decision 123) — every Booking
 * across every linked minor that needs this Guardian's Confirm/Cancel after a
 * BookingDelegation withdrawal. Not paginated — same small-list reasoning as
 * useMyMinors()/useMyBookingDelegations(). */
export function usePendingReviewBookings() {
  return useQuery({
    queryKey: ['pending-review-bookings'],
    queryFn: () => unwrap(apiClient.GET('/v1/guardians/me/bookings-pending-review', {})),
  });
}

/** PATCH /guardians/me/bookings-pending-review/{bookingId}/confirm — clears the
 * review flag without touching the Booking itself (no cancellation, no credit
 * change). Cancelling instead reuses the existing, already-built
 * PATCH /bookings/{id}/cancel on-behalf-of path directly (see
 * PendingReviewScreen.tsx) rather than a second new mutation here. */
export function useConfirmPendingReviewBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, studentId }: { bookingId: string; studentId: string }) =>
      unwrap(
        apiClient.PATCH('/v1/guardians/me/bookings-pending-review/{bookingId}/confirm', {
          params: { path: { bookingId } },
          body: { studentId },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pending-review-bookings'] }),
  });
}

/** PATCH /bookings/{id}/cancel, Guardian-on-behalf-of (the existing, already-built
 * path — CancelBookingDto's own `studentId` hint, not a new endpoint). Used by
 * PendingReviewScreen's "Cancel" action; also invalidates the review-queue list
 * since a cancelled Booking is no longer UPCOMING and will stop matching it. */
export function useCancelPendingReviewBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, studentId }: { bookingId: string; studentId: string }) =>
      unwrap(apiClient.PATCH('/v1/bookings/{id}/cancel', { params: { path: { id: bookingId } }, body: { studentId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pending-review-bookings'] }),
  });
}
