import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import * as membershipQueries from './membershipQueries';
import * as paymentMethodQueries from '../payments/paymentMethodQueries';
import * as stepUpQueries from '../auth/stepUpQueries';
import { MembershipPlanRow } from './MembershipPlanRow';

jest.mock('./membershipQueries', () => ({ usePurchaseMembership: jest.fn(), useInvalidateMyMemberships: jest.fn() }));
jest.mock('../payments/paymentMethodQueries', () => ({ usePaymentMethod: jest.fn() }));
jest.mock('../auth/stepUpQueries', () => ({ useVerifyStepUp: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

// The first render loads every React Native component these screens use; on a
// busy CI runner that alone can pass jest's default 5 s (as in myGrading.test.tsx).
jest.setTimeout(30_000);

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const idlePurchase = () => ({ mutate: jest.fn(), data: undefined, isPending: false, isSuccess: false, isError: false, error: null });

const CLASS_PACK = { id: 'plan-1', title: '5-Class Pack', type: 'CLASS_PACK', price: 5000, currency: 'gbp', classesIncluded: 5, expiryDurationDays: null };
const SUBSCRIPTION = { id: 'plan-2', title: 'Unlimited', type: 'SUBSCRIPTION', price: 8000, currency: 'gbp', classesIncluded: null, expiryDurationDays: null };

/**
 * Decision 236's own follow-up — "Pay with saved card" is offered alongside
 * "Purchase" only when this Student has a saved card for this School AND the
 * plan isn't a SUBSCRIPTION (MembershipsService.purchase()'s own explicit
 * block). Mirrors consentStepUp.test.tsx's own house style: mock every query
 * module entirely, inline fixtures, render + fireEvent (both awaited).
 */
describe('MembershipPlanRow — Decision 236 pay-with-saved-card', () => {
  const mkVerifyStepUp = () => ({
    mutate: jest.fn((_passcode: string, opts?: { onSuccess?: (data: { stepUpToken: string }) => void }) => {
      opts?.onSuccess?.({ stepUpToken: 'step-up-token-abc' });
    }),
    isPending: false,
    isError: false,
    error: null,
  });

  let purchase: ReturnType<typeof idlePurchase>;
  let verifyStepUp: ReturnType<typeof mkVerifyStepUp>;
  let invalidateMyMemberships: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    purchase = idlePurchase();
    verifyStepUp = mkVerifyStepUp();
    invalidateMyMemberships = jest.fn();
    mocked(membershipQueries.usePurchaseMembership).mockReturnValue(purchase);
    mocked(membershipQueries.useInvalidateMyMemberships).mockReturnValue(invalidateMyMemberships);
    mocked(stepUpQueries.useVerifyStepUp).mockReturnValue(verifyStepUp);
  });

  it('shows the card surcharge before paying (Decision 406)', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: false } } as never);
    const { getByText } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 125 } as never} schoolId="school-1" />);
    expect(getByText('+ £1.25 card surcharge when paying by card')).toBeTruthy();
  });

  it('shows no card surcharge line when there is none (Decision 406)', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: false } } as never);
    const { queryByText } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 0 } as never} schoolId="school-1" />);
    expect(queryByText(/card surcharge/)).toBeNull();
  });

  it('offers only "Purchase" when nothing is saved for this School', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: false } } as never);

    const { getByText, queryByText } = await render(<MembershipPlanRow plan={CLASS_PACK as never} schoolId="school-1" />);
    expect(getByText('Purchase')).toBeTruthy();
    expect(queryByText('Pay with saved card')).toBeNull();
  });

  it('offers "Pay with saved card" too once a card is saved, for a CLASS_PACK plan', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: true, brand: 'visa', last4: '4242' } } as never);

    const { getByText } = await render(<MembershipPlanRow plan={CLASS_PACK as never} schoolId="school-1" />);
    expect(getByText('Pay with saved card')).toBeTruthy();
  });

  it('does NOT offer "Pay with saved card" for a SUBSCRIPTION plan even with a card saved', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: true } } as never);

    const { getByText, queryByText } = await render(<MembershipPlanRow plan={SUBSCRIPTION as never} schoolId="school-1" />);
    expect(getByText('Purchase')).toBeTruthy();
    expect(queryByText('Pay with saved card')).toBeNull();
  });

  it('tapping "Pay with saved card" shows StepUpPrompt, not an immediate purchase', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: true } } as never);

    const { getByText } = await render(<MembershipPlanRow plan={CLASS_PACK as never} schoolId="school-1" />);
    await fireEvent.press(getByText('Pay with saved card'));

    expect(purchase.mutate).not.toHaveBeenCalled();
    expect(getByText('Re-enter your passcode to confirm.')).toBeTruthy();
  });

  it('a correct passcode in StepUpPrompt calls purchase.mutate with payWithSavedCard and the minted step-up token', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: true } } as never);

    const { getByText, getByTestId } = await render(<MembershipPlanRow plan={CLASS_PACK as never} schoolId="school-1" />);
    await fireEvent.press(getByText('Pay with saved card'));
    await fireEvent.changeText(getByTestId('step-up-passcode-input'), '424242');
    await fireEvent.press(getByText('Confirm'));

    expect(verifyStepUp.mutate).toHaveBeenCalledWith('424242', expect.anything());
    expect(purchase.mutate).toHaveBeenCalledWith({ planId: 'plan-1', payWithSavedCard: true, stepUpToken: 'step-up-token-abc' });
  });

  it('"Purchase" sends useHostedCheckout (Decision 243) — no payWithSavedCard, no step-up', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: true } } as never);

    const { getByText } = await render(<MembershipPlanRow plan={CLASS_PACK as never} schoolId="school-1" />);
    await fireEvent.press(getByText('Purchase'));

    expect(verifyStepUp.mutate).not.toHaveBeenCalled();
    expect(purchase.mutate).toHaveBeenCalledWith(
      { planId: 'plan-1', useHostedCheckout: true },
      expect.objectContaining({ onSuccess: expect.anything() }),
    );
  });
});

/**
 * Decision 243 (Track B Slice 4b) — "Purchase" now completes a Stripe-backed
 * CLASS_PACK/WEEKLY_PASS/TRIAL_MEMBERSHIP purchase end-to-end: it sends
 * useHostedCheckout, and on the real `requires_checkout` outcome opens the
 * returned checkoutUrl in the device's own browser via the exact same
 * `WebBrowser.openAuthSessionAsync` call PaymentMethodsScreen's own
 * card-saving flow (Decision 238) already established — then, mirroring that
 * same screen's own documented single-refetch-after-return choice, invalidates
 * the My Memberships query cache once the browser session ends.
 */
describe('MembershipPlanRow — Decision 243 hosted Checkout', () => {
  let invalidateMyMemberships: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    invalidateMyMemberships = jest.fn();
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: false } } as never);
    mocked(membershipQueries.useInvalidateMyMemberships).mockReturnValue(invalidateMyMemberships);
  });

  it('tapping "Purchase" opens the hosted Checkout URL on requires_checkout, then invalidates My Memberships once the browser session ends', async () => {
    const purchase = {
      ...idlePurchase(),
      mutate: jest.fn((_vars: unknown, opts: { onSuccess?: (result: unknown) => void } | undefined) => {
        opts?.onSuccess?.({ outcome: 'requires_checkout', checkoutUrl: 'https://checkout.stripe.com/pay/cs_1', transactionId: 'txn-1' });
      }),
    };
    mocked(membershipQueries.usePurchaseMembership).mockReturnValue(purchase as never);
    mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: 'dismiss' } as never);

    const { getByText } = await render(<MembershipPlanRow plan={CLASS_PACK as never} schoolId="school-1" />);
    await fireEvent.press(getByText('Purchase'));

    await waitFor(() => {
      expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
        'https://checkout.stripe.com/pay/cs_1',
        'ultm8-student://membership-purchase/complete',
      );
      expect(invalidateMyMemberships).toHaveBeenCalled();
    });
  });

  it('shows a "Payment submitted" message, with no Purchase/Pay-with-saved-card buttons, once outcome is requires_checkout', async () => {
    const purchase = {
      ...idlePurchase(),
      isSuccess: true,
      data: { outcome: 'requires_checkout', checkoutUrl: 'https://checkout.stripe.com/pay/cs_1', transactionId: 'txn-1' },
    };
    mocked(membershipQueries.usePurchaseMembership).mockReturnValue(purchase as never);

    const { getByText, queryByText } = await render(<MembershipPlanRow plan={CLASS_PACK as never} schoolId="school-1" />);

    expect(getByText(/Payment submitted/)).toBeTruthy();
    expect(queryByText('Purchase')).toBeNull();
    expect(queryByText('Pay with saved card')).toBeNull();
  });

  it('a SUBSCRIPTION plan still falls back to the old requires_payment "not available" message — Decision 243 does not cover Subscriptions', async () => {
    const purchase = {
      ...idlePurchase(),
      isSuccess: true,
      data: { outcome: 'requires_payment', clientSecret: 'secret_1', transactionId: 'txn-2' },
    };
    mocked(membershipQueries.usePurchaseMembership).mockReturnValue(purchase as never);

    const { getByText } = await render(<MembershipPlanRow plan={SUBSCRIPTION as never} schoolId="school-1" />);

    expect(getByText(/isn't available in the app yet/)).toBeTruthy();
  });
});
