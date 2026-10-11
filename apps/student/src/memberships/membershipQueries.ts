import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { usePaginatedQuery } from '../lib/usePaginatedQuery';

/** GET /memberships/me — a Student's own current Memberships. Cursor-paginated, same
 * convention as My Bookings/Academies (Decision 22/70). MembershipStatus is
 * ACTIVE/EXPIRED (apps/api/prisma/schema.prisma) — both are real, resolved states,
 * unlike Booking's UPCOMING (nothing to gate a client action on here; this is a
 * read-only list, Slice 4a builds no cancel/renew flow). */
export function useMyMemberships() {
  return usePaginatedQuery(['my-memberships'], (cursor) =>
    unwrap(apiClient.GET('/v1/memberships/me', { params: { query: { cursor } } })),
  );
}

/** POST /membership-plans/{id}/purchase — self-purchase only; `studentId` on
 * PurchaseMembershipDto is the same Staff/Guardian on-behalf-of field as
 * BookClassDto's (see bookingQueries.ts), never sent here. Returns a
 * discriminated union (verified in MembershipsService.purchase(),
 * apps/api/src/memberships/memberships.service.ts): `active` (immediate — a
 * £0-priced plan, OR Decision 236's payWithSavedCard branch below, which is
 * also synchronous), `pending_confirmation` (Cash/Bank Transfer, Staff
 * confirms later via a Staff-only endpoint — out of scope here), or
 * `requires_payment` (a fresh-card Stripe purchase — Slice 4b, still not
 * built; this is the one outcome this hook/MembershipPlanRow cannot complete
 * client-side, since it needs a Stripe Elements confirmation step this app
 * has no SDK for). The caller (MembershipPlanRow) decides what UI each
 * outcome gets; this hook just relays the real response and invalidates the
 * Memberships list on an immediate `active` grant.
 *
 * Decision 236's own follow-up — `payWithSavedCard`/`stepUpToken` let the
 * Student reuse their saved card (Decision 238) instead of a fresh one,
 * sent as the `X-Step-Up-Token` header, same optional-header shape
 * guardianQueries.ts's useWithdrawConsent() already established for this
 * exact mechanism's first consumer. */
export function usePurchaseMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, payWithSavedCard, stepUpToken }: { planId: string; payWithSavedCard?: boolean; stepUpToken?: string }) =>
      unwrap(
        apiClient.POST('/v1/membership-plans/{id}/purchase', {
          params: { path: { id: planId } },
          body: payWithSavedCard ? { payWithSavedCard: true } : {},
          headers: stepUpToken ? { 'X-Step-Up-Token': stepUpToken } : undefined,
        }),
      ),
    onSuccess: (result) => {
      if (result.outcome === 'active') {
        return queryClient.invalidateQueries({ queryKey: ['my-memberships'] });
      }
    },
  });
}
