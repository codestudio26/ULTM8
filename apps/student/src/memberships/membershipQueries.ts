import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { usePaginatedQuery } from '../lib/usePaginatedQuery';

/** GET /memberships/me — a Student's own current Memberships. Cursor-paginated, same
 * convention as My Bookings/Academies (Decision 22/70). MembershipStatus is
 * ACTIVE/EXPIRED (apps/api/prisma/schema.prisma) — both are real, resolved states,
 * unlike Booking's UPCOMING. The one action, cancelling a Subscription, is
 * useCancelSubscription() below (Decision NNN). */
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
 * confirms later via a Staff-only endpoint — out of scope here),
 * `requires_checkout` (Decision 243, Track B Slice 4b — a hosted Stripe
 * Checkout Session URL; MembershipPlanRow opens it via expo-web-browser), or
 * `requires_payment` (a bare Stripe Elements clientSecret — unreachable from
 * this app's own "Purchase" button as of Decision 243, which always sends
 * useHostedCheckout instead; still returned for a SUBSCRIPTION plan, which
 * Decision 243 explicitly does not cover — PaymentsService.subscribe()'s own
 * pre-existing limitation, see MembershipPlanRow's own header comment). The
 * caller (MembershipPlanRow) decides what UI each outcome gets; this hook
 * just relays the real response and invalidates the Memberships list on an
 * immediate `active` grant.
 *
 * Decision 236's own follow-up — `payWithSavedCard`/`stepUpToken` let the
 * Student reuse their saved card (Decision 238) instead of a fresh one,
 * sent as the `X-Step-Up-Token` header, same optional-header shape
 * guardianQueries.ts's useWithdrawConsent() already established for this
 * exact mechanism's first consumer.
 *
 * Decision 243's own follow-up — `useHostedCheckout` collects a fresh card
 * via a hosted Stripe Checkout Session instead (mutually exclusive with
 * payWithSavedCard, enforced server-side). */
export function usePurchaseMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      planId,
      payWithSavedCard,
      useHostedCheckout,
      stepUpToken,
    }: {
      planId: string;
      payWithSavedCard?: boolean;
      useHostedCheckout?: boolean;
      stepUpToken?: string;
    }) =>
      unwrap(
        apiClient.POST('/v1/membership-plans/{id}/purchase', {
          params: { path: { id: planId } },
          body: payWithSavedCard ? { payWithSavedCard: true } : useHostedCheckout ? { useHostedCheckout: true } : {},
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

/**
 * Decision 243's own post-return refresh — mirrors Decision 238's
 * PaymentMethodsScreen, which refetches its own per-School GET query right
 * after `WebBrowser.openAuthSessionAsync` resolves, accepting the same
 * documented "the real confirmation is a webhook that can land a moment
 * after the browser closes" staleness window rather than an infinite
 * poll/retry loop. A Membership purchase has no equivalent single
 * per-School/per-plan GET query to re-run from MembershipPlanRow itself (`My
 * Memberships` is a separate screen), so this invalidates the
 * `['my-memberships']` query cache instead — the next time that screen (or
 * this row, if it ever grows its own read) is visited, it fetches fresh.
 * Kept as its own hook (rather than inlined in the component) purely so the
 * component test can mock it the same wholesale-module way every other query
 * hook here already is, without needing a real QueryClientProvider in the
 * render tree.
 */
export function useInvalidateMyMemberships() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['my-memberships'] });
}

/** POST /memberships/{id}/cancel (Decision NNN) — cancels the Student's own
 * Subscription at the end of the paid period. The Membership stays live until
 * then and comes back with `cancelAt` set. */
export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) =>
      unwrap(apiClient.POST('/v1/memberships/{id}/cancel', { params: { path: { id: membershipId } }, body: {} })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-memberships'] }),
  });
}
