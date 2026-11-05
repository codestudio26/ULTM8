import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { components } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatMoney } from '../lib/formatMoney';
import { formatDateOnly } from '../lib/formatDate';
import { StepUpPrompt } from '../auth/StepUpPrompt';
import { usePaymentMethod } from '../payments/paymentMethodQueries';
import { useInvalidateMyMemberships, usePurchaseMembership } from './membershipQueries';
import { useT } from '../i18n/I18nProvider';
import { PlanContractSigner } from './PlanContractSigner';

type MembershipPlan = components['schemas']['AcademyMembershipPlanDto'];
type PurchaseOutcome = { outcome: string; checkoutUrl?: string };

/** One membership plan on AcademyDetailScreen (Slice 4a, extended by Track B
 * Slice 4b — Decision 243). Four real outcomes from POST
 * /membership-plans/{id}/purchase (verified in MembershipsService.purchase()):
 * `active` (an immediate, £0 grant, OR Decision 236's payWithSavedCard branch below),
 * `pending_confirmation` (Cash/Bank Transfer — awaiting Staff confirmation, no further
 * Student action), `requires_checkout` (Decision 243 — a hosted Stripe Checkout
 * Session, opened in the device's own browser), and `requires_payment` (a bare
 * Stripe Elements clientSecret this app has no SDK to render — unreachable from
 * the plain "Purchase" button as of Decision 243, which always sends
 * useHostedCheckout; still the real outcome for a SUBSCRIPTION plan, which
 * Decision 243 deliberately does not cover — PaymentsService.subscribe()'s own
 * pre-existing "throwaway Customer every call" limitation, same one
 * payWithSavedCard's SUBSCRIPTION block below is scoped around — so that one
 * message stays, shown honestly rather than silently failing).
 *
 * Decision 243 (Track B Slice 4b) — "Purchase" now completes end-to-end for a
 * Stripe-backed CLASS_PACK/WEEKLY_PASS/TRIAL_MEMBERSHIP plan: it sends
 * `useHostedCheckout: true`, and on `requires_checkout` opens the returned
 * `checkoutUrl` in the device's own browser via `WebBrowser.openAuthSessionAsync`
 * — the exact same call PaymentMethodsScreen's own card-saving flow already
 * uses (Decision 238), auto-returning via the same `ultm8-student://` scheme.
 * The real confirmation is the async `payment_intent.succeeded` webhook
 * (StripeWebhookProcessingProcessor — reused as-is, no new handler), which can
 * land a moment after the browser closes — mirrors PaymentMethodsScreen's own
 * documented choice exactly: one refetch (here, invalidating the My
 * Memberships list — see useInvalidateMyMemberships's own header comment)
 * right after the browser session ends, accepting a brief staleness window
 * rather than an infinite poll/retry loop. Revisiting My Memberships always
 * shows the settled state.
 *
 * Decision 236's own follow-up — "Pay with saved card" (Decision 238's saved
 * payment method, gated by step-up re-authentication) is offered as a second
 * action alongside "Purchase" whenever this Student has one saved for this
 * School. Unlike the hosted-Checkout path above, this one IS synchronous — no
 * browser round-trip, the outcome (`active`, or a thrown 400/402) is known
 * immediately. Not offered for SUBSCRIPTION plans (MembershipsService.
 * purchase()'s own explicit block — PaymentsService.subscribe() doesn't reuse
 * StudentPaymentMethod, a separate pre-existing limitation, not fixed by this
 * follow-up).
 *
 * Purchase outcome is read directly from the mutation's own state (`purchase.data`/
 * `purchase.isSuccess`) rather than mirrored into a separate useState — found on
 * review: the original version's local RowState could set state after the component
 * unmounted (e.g. Student navigates away mid-purchase), and duplicated
 * purchase.error into a second `actionError` state that could drift from it. */
/** `forStudentId`: a Guardian buys this plan for their child (no saved card then). */
/** `canBuy` false (Decision 427, SP10): a School the person hasn't joined.
 * Buying there always failed with "Not found", so the plan shows a
 * "join first" note instead of Purchase. */
/** `switchTo` (Decision 435 item 9): the plan this one can switch to when it
 * ends, from the same list; the member agrees to it before buying, or not. */
export function MembershipPlanRow({
  plan,
  schoolId,
  forStudentId,
  canBuy = true,
  switchTo,
}: {
  plan: MembershipPlan;
  schoolId: string;
  forStudentId?: string;
  canBuy?: boolean;
  switchTo?: Pick<MembershipPlan, 'title' | 'price' | 'currency'>;
}) {
  const t = useT();
  const purchase = usePurchaseMembership();
  const invalidateMyMemberships = useInvalidateMyMemberships();
  const { data: paymentMethod } = usePaymentMethod(schoolId);
  const [steppingUp, setSteppingUp] = useState(false);
  // Decision 316 item 6: a plan with a contract is signed first; the
  // signature then goes with the purchase (and the step-up, for a saved card).
  const hasContract = plan.contractVersion != null;
  const [signing, setSigning] = useState<'checkout' | 'savedCard' | null>(null);
  const [contractSignatureId, setContractSignatureId] = useState<string | undefined>(undefined);
  // Decision 435 item 9: off until the member (a parent for a child) agrees.
  const [agreeToSwitch, setAgreeToSwitch] = useState(false);
  const switchTerms = plan.switchToPlanId && switchTo ? { agreeToPlanSwitch: agreeToSwitch } : {};
  const isFriendPass = plan.type === 'FRIEND_PASS';
  const outcome = purchase.isSuccess ? purchase.data.outcome : null;
  const canPayWithSavedCard = !forStudentId && !isFriendPass && plan.type !== 'SUBSCRIPTION' && !!paymentMethod?.hasSavedPaymentMethod;

  async function openCheckoutAndRefetch(checkoutUrl: string) {
    try {
      await WebBrowser.openAuthSessionAsync(checkoutUrl, 'ultm8-student://membership-purchase/complete');
    } finally {
      invalidateMyMemberships();
    }
  }

  function handlePurchaseSuccess(result: PurchaseOutcome) {
    if (result.outcome === 'requires_checkout' && result.checkoutUrl) {
      openCheckoutAndRefetch(result.checkoutUrl);
    }
  }

  function handlePurchase() {
    if (purchase.isPending) return;
    if (hasContract) return setSigning('checkout');
    purchase.mutate({ planId: plan.id, useHostedCheckout: true, studentId: forStudentId, ...switchTerms }, { onSuccess: handlePurchaseSuccess });
  }

  function openPayWithSavedCard() {
    if (purchase.isPending) return;
    if (hasContract) return setSigning('savedCard');
    setSteppingUp(true);
  }

  function handleContractSigned(signatureId: string) {
    const next = signing;
    setSigning(null);
    setContractSignatureId(signatureId);
    if (next === 'savedCard') {
      setSteppingUp(true);
      return;
    }
    purchase.mutate(
      { planId: plan.id, useHostedCheckout: true, studentId: forStudentId, contractSignatureId: signatureId, ...switchTerms },
      { onSuccess: handlePurchaseSuccess },
    );
  }

  function cancelStepUp() {
    setSteppingUp(false);
  }

  function handleStepUpVerified(stepUpToken: string) {
    setSteppingUp(false);
    purchase.mutate({ planId: plan.id, payWithSavedCard: true, stepUpToken, ...switchTerms, ...(contractSignatureId ? { contractSignatureId } : {}) });
  }

  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <Text style={{ fontWeight: '600' }}>{plan.title}</Text>
      <Text style={{ color: '#5F6368', fontSize: 12, marginTop: 2 }}>
        {[
          formatMoney(plan.price, plan.currency),
          plan.classesIncluded != null ? t('memberships.planRow.classesIncluded', { count: plan.classesIncluded }) : null,
          plan.expiryDurationDays != null ? t('memberships.planRow.durationDays', { count: plan.expiryDurationDays }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {/* Decision 435 items 7-8: when its days start, or the days it runs. */}
      {plan.startsOnFirstCheckIn ? (
        <Text style={{ color: '#5F6368', fontSize: 12, marginTop: 2 }}>{t('memberships.planRow.startsOnFirstCheckIn')}</Text>
      ) : null}
      {plan.fixedStartDate && plan.fixedEndDate ? (
        <Text style={{ color: '#5F6368', fontSize: 12, marginTop: 2 }}>
          {t('memberships.planRow.fixedDates', { from: formatDateOnly(plan.fixedStartDate), to: formatDateOnly(plan.fixedEndDate) })}
        </Text>
      ) : null}
      {/* Decision 435: the joining fee on a first plan (null while the School's joining fees are off). */}
      {plan.joiningFee != null && plan.joiningFee > 0 ? (
        <Text style={{ color: '#5F6368', fontSize: 12, marginTop: 2 }}>
          {t('memberships.planRow.joiningFee', { amount: formatMoney(plan.joiningFee, plan.currency) })}
        </Text>
      ) : null}
      {/* Decision 406: the School's card surcharge, shown before paying. */}
      {plan.cardSurchargeAmount > 0 ? (
        <Text style={{ color: '#5F6368', fontSize: 12, marginTop: 2 }}>
          {t('memberships.planRow.cardSurcharge', { amount: formatMoney(plan.cardSurchargeAmount, plan.currency) })}
        </Text>
      ) : null}

      {purchase.isError ? (
        <InlineError message={getApiErrorMessage(purchase.error, t('memberships.planRow.purchaseError'))} />
      ) : null}

      {/* FRIEND_PASS is School-gifted, never Student self-purchased (confirmed:
          MembershipsService.purchase() 400s any Student attempt) — no button, since a
          working-looking "Purchase" action that always errors is worse than none. */}
      {isFriendPass ? (
        <Text style={{ color: '#9AA0A6', fontSize: 12, marginTop: 4 }}>{t('memberships.planRow.friendPass')}</Text>
      ) : !canBuy ? (
        <Text style={{ color: '#9AA0A6', fontSize: 12, marginTop: 4 }}>{t('memberships.planRow.joinFirst')}</Text>
      ) : outcome === null && signing ? (
        <PlanContractSigner planId={plan.id} forStudentId={forStudentId} onSigned={handleContractSigned} onCancel={() => setSigning(null)} />
      ) : outcome === null && steppingUp ? (
        <StepUpPrompt onVerified={handleStepUpVerified} onCancel={cancelStepUp} />
      ) : outcome === null ? (
        <View>
        {/* Decision 435 item 9: the member agrees to the switch when buying, or it simply ends. */}
        {plan.switchToPlanId && switchTo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Switch
              value={agreeToSwitch}
              onValueChange={setAgreeToSwitch}
              accessibilityLabel={t('memberships.planRow.agreeToSwitch', { plan: switchTo.title, price: formatMoney(switchTo.price, switchTo.currency) })}
            />
            <Text style={{ flex: 1, fontSize: 12, color: '#3C4043' }}>
              {t('memberships.planRow.agreeToSwitch', { plan: switchTo.title, price: formatMoney(switchTo.price, switchTo.currency) })}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', marginTop: 4, gap: 8 }}>
          <Button title={hasContract ? t('memberships.contract.readAndSign') : t('memberships.planRow.purchase')} onPress={handlePurchase} loading={purchase.isPending} />
          {canPayWithSavedCard ? (
            <Button title={t('memberships.planRow.payWithSavedCard')} variant="secondary" onPress={openPayWithSavedCard} loading={purchase.isPending} />
          ) : null}
        </View>
        </View>
      ) : null}


      {outcome === 'active' ? <Text style={{ color: '#188038', fontSize: 13, marginTop: 4 }}>{t('memberships.planRow.enrolled')}</Text> : null}

      {outcome === 'pending_confirmation' ? (
        <Text style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }}>{t('memberships.planRow.pendingConfirmation')}</Text>
      ) : null}

      {outcome === 'requires_checkout' ? (
        <Text style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }}>
          {t('memberships.planRow.checkoutSubmitted')}
        </Text>
      ) : null}

      {outcome === 'requires_payment' ? (
        <Text style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }}>
          {t('memberships.planRow.onlinePaymentUnavailable')}
        </Text>
      ) : null}
    </View>
  );
}
