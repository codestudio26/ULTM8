import React from 'react';
import { Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatMoney } from '../lib/formatMoney';
import { usePurchaseMembership } from './membershipQueries';

type MembershipPlan = components['schemas']['AcademyMembershipPlanDto'];

/** One membership plan on AcademyDetailScreen (Slice 4a). Three real outcomes from
 * POST /membership-plans/{id}/purchase (verified in MembershipsService.purchase()):
 * `active` (an immediate, £0 grant), `pending_confirmation` (Cash/Bank Transfer —
 * awaiting Staff confirmation, no further Student action), and `requires_payment`
 * (Stripe — Slice 4b, not built yet; shown honestly rather than silently failing).
 *
 * KNOWN, ACCEPTED COST of `requires_payment` (found on review, not fixed here): a tap
 * on a Stripe-backed plan still runs the real server-side purchase() branch, which
 * creates an actual Transaction row and a live Stripe PaymentIntent/subscription
 * before this screen shows its "not available yet" message — the client has no way to
 * avoid this today because neither AcademyMembershipPlanDto nor AcademyDetailDto
 * exposes any signal about whether a plan's School uses Stripe (PaymentAccount detail
 * is Staff/school-portal-only). Flagged as a backend follow-up (a
 * `requiresOnlinePayment` field on AcademyMembershipPlanDto would let the client
 * pre-filter), not silently worked around with a guess.
 *
 * Purchase outcome is read directly from the mutation's own state (`purchase.data`/
 * `purchase.isSuccess`) rather than mirrored into a separate useState — found on
 * review: the original version's local RowState could set state after the component
 * unmounted (e.g. Student navigates away mid-purchase), and duplicated
 * purchase.error into a second `actionError` state that could drift from it. */
export function MembershipPlanRow({ plan }: { plan: MembershipPlan }) {
  const purchase = usePurchaseMembership();
  const isFriendPass = plan.type === 'FRIEND_PASS';
  const outcome = purchase.isSuccess ? purchase.data.outcome : null;

  function handlePurchase() {
    if (purchase.isPending) return;
    purchase.mutate(plan.id);
  }

  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <Text style={{ fontWeight: '600' }}>{plan.title}</Text>
      <Text style={{ color: '#5F6368', fontSize: 12, marginTop: 2 }}>
        {formatMoney(plan.price, plan.currency)}
        {plan.classesIncluded != null ? ` · ${plan.classesIncluded} classes` : ''}
        {plan.expiryDurationDays != null ? ` · ${plan.expiryDurationDays} days` : ''}
      </Text>

      {purchase.isError ? (
        <InlineError message={getApiErrorMessage(purchase.error, 'Could not complete this purchase — please try again.')} />
      ) : null}

      {/* FRIEND_PASS is School-gifted, never Student self-purchased (confirmed:
          MembershipsService.purchase() 400s any Student attempt) — no button, since a
          working-looking "Purchase" action that always errors is worse than none. */}
      {isFriendPass ? (
        <Text style={{ color: '#9AA0A6', fontSize: 12, marginTop: 4 }}>Ask School staff for a Friend Pass.</Text>
      ) : outcome === null ? (
        <Button title="Purchase" onPress={handlePurchase} loading={purchase.isPending} />
      ) : null}

      {outcome === 'active' ? <Text style={{ color: '#188038', fontSize: 13, marginTop: 4 }}>You're enrolled ✓</Text> : null}

      {outcome === 'pending_confirmation' ? (
        <Text style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }}>Payment pending confirmation by the School.</Text>
      ) : null}

      {outcome === 'requires_payment' ? (
        <Text style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }}>
          Online payment for this plan isn't available in the app yet.
        </Text>
      ) : null}
    </View>
  );
}
