import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatMoney } from '../lib/formatMoney';
import { StepUpPrompt } from '../auth/StepUpPrompt';
import { usePaymentMethod } from '../payments/paymentMethodQueries';
import { usePurchaseMembership } from './membershipQueries';

type MembershipPlan = components['schemas']['AcademyMembershipPlanDto'];

/** One membership plan on AcademyDetailScreen (Slice 4a). Three real outcomes from
 * POST /membership-plans/{id}/purchase (verified in MembershipsService.purchase()):
 * `active` (an immediate, £0 grant, OR Decision 236's payWithSavedCard branch below),
 * `pending_confirmation` (Cash/Bank Transfer — awaiting Staff confirmation, no further
 * Student action), and `requires_payment` (a fresh-card Stripe purchase — Slice 4b,
 * still not built; shown honestly rather than silently failing).
 *
 * KNOWN, ACCEPTED COST of `requires_payment` (found on review, not fixed here): a tap
 * on "Purchase" for a Stripe-backed plan still runs the real server-side purchase()
 * branch, which creates an actual Transaction row and a live Stripe PaymentIntent/
 * subscription before this screen shows its "not available yet" message — the client
 * has no way to avoid this today because neither AcademyMembershipPlanDto nor
 * AcademyDetailDto exposes any signal about whether a plan's School uses Stripe
 * (PaymentAccount detail is Staff/school-portal-only). Flagged as a backend follow-up
 * (a `requiresOnlinePayment` field on AcademyMembershipPlanDto would let the client
 * pre-filter), not silently worked around with a guess.
 *
 * Decision 236's own follow-up — "Pay with saved card" (Decision 238's saved
 * payment method, gated by step-up re-authentication) is offered as a second
 * action alongside "Purchase" whenever this Student has one saved for this
 * School. Unlike the fresh-card path above, this one IS synchronous — no
 * Stripe Elements confirmation step, the outcome (`active`, or a thrown
 * 400/402) is known immediately — so it's built here even though the
 * fresh-card flow still isn't. Not offered for SUBSCRIPTION plans
 * (MembershipsService.purchase()'s own explicit block — PaymentsService.
 * subscribe() doesn't reuse StudentPaymentMethod, a separate pre-existing
 * limitation, not fixed by this follow-up).
 *
 * Purchase outcome is read directly from the mutation's own state (`purchase.data`/
 * `purchase.isSuccess`) rather than mirrored into a separate useState — found on
 * review: the original version's local RowState could set state after the component
 * unmounted (e.g. Student navigates away mid-purchase), and duplicated
 * purchase.error into a second `actionError` state that could drift from it. */
export function MembershipPlanRow({ plan, schoolId }: { plan: MembershipPlan; schoolId: string }) {
  const purchase = usePurchaseMembership();
  const { data: paymentMethod } = usePaymentMethod(schoolId);
  const [steppingUp, setSteppingUp] = useState(false);
  const isFriendPass = plan.type === 'FRIEND_PASS';
  const outcome = purchase.isSuccess ? purchase.data.outcome : null;
  const canPayWithSavedCard = !isFriendPass && plan.type !== 'SUBSCRIPTION' && !!paymentMethod?.hasSavedPaymentMethod;

  function handlePurchase() {
    if (purchase.isPending) return;
    purchase.mutate({ planId: plan.id });
  }

  function openPayWithSavedCard() {
    if (purchase.isPending) return;
    setSteppingUp(true);
  }

  function cancelStepUp() {
    setSteppingUp(false);
  }

  function handleStepUpVerified(stepUpToken: string) {
    setSteppingUp(false);
    purchase.mutate({ planId: plan.id, payWithSavedCard: true, stepUpToken });
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
      ) : outcome === null && steppingUp ? (
        <StepUpPrompt onVerified={handleStepUpVerified} onCancel={cancelStepUp} />
      ) : outcome === null ? (
        <View style={{ flexDirection: 'row', marginTop: 4, gap: 8 }}>
          <Button title="Purchase" onPress={handlePurchase} loading={purchase.isPending} />
          {canPayWithSavedCard ? (
            <Button title="Pay with saved card" variant="secondary" onPress={openPayWithSavedCard} loading={purchase.isPending} />
          ) : null}
        </View>
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
