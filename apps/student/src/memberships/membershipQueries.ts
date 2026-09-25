import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** GET /memberships/me — a Student's own current Memberships. Cursor-paginated, same
 * convention as My Bookings/Academies (Decision 22/70). MembershipStatus is
 * ACTIVE/EXPIRED (apps/api/prisma/schema.prisma) — both are real, resolved states,
 * unlike Booking's UPCOMING (nothing to gate a client action on here; this is a
 * read-only list, Slice 4a builds no cancel/renew flow). */
export function useMyMemberships() {
  return useInfiniteQuery({
    queryKey: ['my-memberships'],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      unwrap(apiClient.GET('/v1/memberships/me', { params: { query: { cursor: pageParam } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** POST /membership-plans/{id}/purchase — empty body; sourceMembership-style credit
 * selection doesn't apply here, this creates the Membership itself. Returns a
 * discriminated union (verified in MembershipsService.purchase(),
 * apps/api/src/memberships/memberships.service.ts:181-297): `active` (immediate —
 * only reachable for a non-Stripe, non-zero-price... actually confirmed only for a
 * £0-priced plan, since any non-zero price on a Stripe PaymentAccount always requires
 * payment, and a non-zero price on Cash/Bank goes to pending_confirmation instead),
 * `pending_confirmation` (Cash/Bank Transfer, Staff confirms later via a Staff-only
 * endpoint — out of scope here), or `requires_payment` (Stripe — Slice 4b, not built).
 * The caller (MembershipPlanRow) decides what UI each outcome gets; this hook just
 * relays the real response and invalidates the Memberships list on an immediate
 * `active` grant. */
export function usePurchaseMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    // Self-purchase only — an empty body. `studentId` on PurchaseMembershipDto is the
    // same Staff/Guardian on-behalf-of field as BookClassDto's (see
    // bookingQueries.ts); a Student purchasing their own Membership never sends it.
    mutationFn: (planId: string) => unwrap(apiClient.POST('/v1/membership-plans/{id}/purchase', { params: { path: { id: planId } }, body: {} })),
    onSuccess: (result) => {
      if (result.outcome === 'active') {
        return queryClient.invalidateQueries({ queryKey: ['my-memberships'] });
      }
    },
  });
}
