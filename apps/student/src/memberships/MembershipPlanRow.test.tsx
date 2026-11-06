import React from 'react';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import * as membershipQueries from './membershipQueries';
import * as paymentMethodQueries from '../payments/paymentMethodQueries';
import * as stepUpQueries from '../auth/stepUpQueries';
import { ApiError } from '@ultm8/api-client';
import { MembershipPlanRow } from './MembershipPlanRow';
import * as planContractQueries from './planContractQueries';
import * as academyQueries from '../academies/academyQueries';

jest.mock('./membershipQueries', () => ({ usePurchaseMembership: jest.fn(), useInvalidateMyMemberships: jest.fn() }));
jest.mock('../payments/paymentMethodQueries', () => ({ usePaymentMethod: jest.fn() }));
// Decision 437: the School's profile says whether it takes card payments
// (unknown, as while it loads, unless a test says otherwise).
jest.mock('../academies/academyQueries', () => ({ useAcademy: jest.fn(() => ({ data: undefined })) }));
jest.mock('../auth/stepUpQueries', () => ({ useVerifyStepUp: jest.fn() }));
// Decision 435 items 10-15: the waiting-list buttons' mutations.
const mockWaitlistJoin = jest.fn();
const mockWaitlistLeave = jest.fn();
jest.mock('./planWaitlistQueries', () => ({
  usePlanWaitlist: () => ({
    join: { mutate: mockWaitlistJoin, isPending: false, error: null },
    leave: { mutate: mockWaitlistLeave, isPending: false, error: null },
  }),
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
// Decision 316 item 6: the contract signer's queries and its signature pad
// (a WebView canvas this environment can't run; see WaiverRow.test.tsx).
jest.mock('./planContractQueries', () => ({ usePlanContract: jest.fn(), useSignPlanContract: jest.fn() }));
jest.mock('react-native-signature-canvas', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  const SignatureScreen = ReactActual.forwardRef((_props: unknown, ref: unknown) => {
    ReactActual.useImperativeHandle(ref, () => ({ clearSignature: jest.fn(), readSignature: jest.fn() }));
    return <Text>pad</Text>;
  });
  return { __esModule: true, default: SignatureScreen };
});

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

  it('shows when a plan starts or runs, and buys with the switch only once the member agrees (Decision 435)', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: false } } as never);
    const plan = { ...CLASS_PACK, cardSurchargeAmount: 0, startsOnFirstCheckIn: true, switchToPlanId: 'plan-9' };
    const { getByText, getByRole, unmount } = await render(
      <MembershipPlanRow plan={plan as never} schoolId="school-1" switchTo={{ title: 'Ten classes', price: 6000, currency: 'gbp' }} />,
    );
    expect(getByText('Starts on your first check-in')).toBeTruthy();
    // Decision 438 item 2 / Decision 436 item 8: a full next plan ends it too, with nothing charged.
    expect(getByText(/^When it ends, switch me to Ten classes \(.+\), charged to my saved card\. I'll be told before; without a saved card, or if Ten classes is full, it simply ends and nothing is charged\.$/)).toBeTruthy();
    await fireEvent.press(getByText('Purchase'));
    expect(purchase.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ planId: 'plan-1', agreeToPlanSwitch: false }), expect.anything());
    await fireEvent(getByRole('switch'), 'valueChange', true);
    await fireEvent.press(getByText('Purchase'));
    expect(purchase.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ agreeToPlanSwitch: true }), expect.anything());
    await unmount();
    const camp = { ...CLASS_PACK, cardSurchargeAmount: 0, fixedStartDate: '2027-07-01T00:00:00.000Z', fixedEndDate: '2027-08-11T00:00:00.000Z' };
    const { getByText: text } = await render(<MembershipPlanRow plan={camp as never} schoolId="school-1" />);
    expect(text(/^Runs /)).toBeTruthy();
  });

  it('shows the joining fee on a first plan, and nothing when the plan has none (Decision 435)', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: false } } as never);
    const { getByText, unmount } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 0, joiningFee: 2500 } as never} schoolId="school-1" />);
    expect(getByText('+ £25.00 joining fee on your first plan at this School')).toBeTruthy();
    await unmount();
    const { queryByText } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 0, joiningFee: null } as never} schoolId="school-1" />);
    expect(queryByText(/joining fee/)).toBeNull();
  });

  it('a full plan offers its waiting list instead of Purchase; a place held shows Purchase again (Decision 435)', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: false } } as never);
    const plan = { ...CLASS_PACK, cardSurchargeAmount: 0, memberLimit: 10 };
    const full = { planId: 'plan-1', full: true, waitlist: null };
    const { getByText, queryByText, unmount } = await render(<MembershipPlanRow plan={plan as never} schoolId="school-1" availability={full as never} />);
    expect(queryByText('Purchase')).toBeNull();
    await fireEvent.press(getByText('Join the waiting list'));
    expect(mockWaitlistJoin).toHaveBeenCalledWith({ planId: 'plan-1', studentId: undefined });
    await unmount();
    const waiting = { planId: 'plan-1', full: true, waitlist: { id: 'w', status: 'WAITING', position: 3, offerExpiresAt: null } };
    const second = await render(<MembershipPlanRow plan={plan as never} schoolId="school-1" forStudentId="kid-1" availability={waiting as never} />);
    expect(second.getByText("You're number 3 on the waiting list.")).toBeTruthy();
    await fireEvent.press(second.getByText('Leave the waiting list'));
    expect(mockWaitlistLeave).toHaveBeenCalledWith({ planId: 'plan-1', studentId: 'kid-1' });
    await second.unmount();
    const held = { planId: 'plan-1', full: false, waitlist: { id: 'w', status: 'OFFERED', position: null, offerExpiresAt: '2027-01-02T10:00:00.000Z' } };
    const third = await render(<MembershipPlanRow plan={plan as never} schoolId="school-1" availability={held as never} />);
    expect(third.getByText(/A place is held for you until/)).toBeTruthy();
    expect(third.getByText('Purchase')).toBeTruthy();
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

/** Decision 427 — Student portal review SP10: a School not joined yet. */
describe('MembershipPlanRow — not joined yet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked(membershipQueries.usePurchaseMembership).mockReturnValue(idlePurchase());
    mocked(membershipQueries.useInvalidateMyMemberships).mockReturnValue(jest.fn());
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: undefined } as never);
  });

  it('says to join first instead of offering Purchase', async () => {
    const { getByText, queryByText } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 0 } as never} schoolId="school-1" canBuy={false} />);
    expect(getByText('Join this School to buy.')).toBeTruthy();
    expect(queryByText('Purchase')).toBeNull();
  });
});

/** Decision 316 item 6: a plan with a contract is read and signed first. */
describe('MembershipPlanRow — plan contract', () => {
  let purchase: ReturnType<typeof idlePurchase>;
  let signMutate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    purchase = idlePurchase();
    mocked(membershipQueries.usePurchaseMembership).mockReturnValue(purchase);
    mocked(membershipQueries.useInvalidateMyMemberships).mockReturnValue(jest.fn());
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: false } } as never);
    mocked(planContractQueries.usePlanContract).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { planId: 'plan-1', planTitle: '5-Class Pack', planType: 'CLASS_PACK', body: 'No refunds after the first class.', minimumTermMonths: null, earlyExitFee: null, currency: 'GBP', version: 3 },
    } as never);
    signMutate = jest.fn((_vars: unknown, opts?: { onSuccess?: (s: { id: string }) => void }) => opts?.onSuccess?.({ id: 'sig-1' })) as unknown as jest.Mock;
    mocked(planContractQueries.useSignPlanContract).mockReturnValue({ mutate: signMutate, isPending: false, isError: false, error: null } as never);
  });

  it('shows the contract instead of buying at once, then buys with the signature', async () => {
    const plan = { ...CLASS_PACK, cardSurchargeAmount: 0, contractVersion: 3 };
    const { getByText, getByPlaceholderText } = await render(<MembershipPlanRow plan={plan as never} schoolId="school-1" />);
    await fireEvent.press(getByText('Read and sign the contract'));
    expect(purchase.mutate).not.toHaveBeenCalled();
    expect(getByText('No refunds after the first class.')).toBeTruthy();

    await fireEvent.changeText(getByPlaceholderText('Your full legal name'), 'Pat Member');
    await fireEvent.changeText(getByPlaceholderText('Type your signature'), 'Pat Member');
    await fireEvent.press(getByText('Sign and continue'));

    expect(signMutate).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-1', contractVersion: 3, signerFullName: 'Pat Member' }), expect.anything());
    expect(purchase.mutate).toHaveBeenCalledWith(
      { planId: 'plan-1', useHostedCheckout: true, studentId: undefined, contractSignatureId: 'sig-1' },
      expect.anything(),
    );
  });

  it('a plan without a contract still buys straight away', async () => {
    const { getByText } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 0, contractVersion: null } as never} schoolId="school-1" />);
    await fireEvent.press(getByText('Purchase'));
    expect(purchase.mutate).toHaveBeenCalled();
    expect(signMutate).not.toHaveBeenCalled();
  });
});

/**
 * Decision 437 — at a School without card payments (no Stripe account; Brazil
 * for now) the member is told to pay by bank transfer or cash at the School
 * (Pix too in Brazil), which staff confirm; Purchase then asks for the
 * School's Cash/Bank payment, never Stripe's hosted Checkout or a saved card.
 */
describe('MembershipPlanRow — School without card payments (Decision 437)', () => {
  let purchase: ReturnType<typeof idlePurchase>;

  beforeEach(() => {
    jest.clearAllMocks();
    purchase = idlePurchase();
    mocked(membershipQueries.usePurchaseMembership).mockReturnValue(purchase);
    mocked(membershipQueries.useInvalidateMyMemberships).mockReturnValue(jest.fn());
    mocked(stepUpQueries.useVerifyStepUp).mockReturnValue({ mutate: jest.fn(), isPending: false, isError: false, error: null });
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: true, brand: 'visa', last4: '4242' } } as never);
  });

  afterEach(() => {
    mocked(academyQueries.useAcademy).mockReturnValue({ data: undefined });
  });

  it('a Brazilian School: the note mentions Pix, and Purchase is a Cash/Bank payment with no saved-card option', async () => {
    mocked(academyQueries.useAcademy).mockReturnValue({ data: { cardPayments: false, inBrazil: true } });
    const { getByTestId, getByText, queryByText } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 0 } as never} schoolId="school-1" />);
    expect(academyQueries.useAcademy).toHaveBeenCalledWith('school-1');
    expect(getByTestId('no-card-payments').props.children).toBe(
      "Card payments aren't available at this School yet. Pay by Pix, bank transfer or cash at the School, and staff will confirm it.",
    );
    expect(queryByText('Pay with saved card')).toBeNull();
    await fireEvent.press(getByText('Purchase'));
    expect(purchase.mutate).toHaveBeenCalledWith({ planId: 'plan-1', studentId: undefined }, expect.anything());
  });

  it('elsewhere without card payments the note leaves Pix out', async () => {
    mocked(academyQueries.useAcademy).mockReturnValue({ data: { cardPayments: false, inBrazil: false } });
    const { getByTestId } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 0 } as never} schoolId="school-1" />);
    expect(getByTestId('no-card-payments').props.children).toBe(
      "Card payments aren't available at this School yet. Pay by bank transfer or cash at the School, and staff will confirm it.",
    );
  });

  it('offers no plan switch, and sends no agreement, where the School takes no cards (Decision 441 item 3)', async () => {
    mocked(academyQueries.useAcademy).mockReturnValue({ data: { cardPayments: false, inBrazil: true } });
    const plan = { ...CLASS_PACK, cardSurchargeAmount: 0, switchToPlanId: 'plan-9' };
    const { getByText, queryByRole, queryByText } = await render(
      <MembershipPlanRow plan={plan as never} schoolId="school-1" switchTo={{ title: 'Ten classes', price: 6000, currency: 'brl' }} />,
    );
    expect(queryByRole('switch')).toBeNull();
    expect(queryByText(/switch me to Ten classes/)).toBeNull();
    await fireEvent.press(getByText('Purchase'));
    expect(purchase.mutate).toHaveBeenCalledWith({ planId: 'plan-1', studentId: undefined }, expect.anything());
  });

  it('a School that takes cards shows no note and keeps hosted Checkout and the saved card', async () => {
    mocked(academyQueries.useAcademy).mockReturnValue({ data: { cardPayments: true, inBrazil: false } });
    const { getByText, queryByTestId } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 0 } as never} schoolId="school-1" />);
    expect(queryByTestId('no-card-payments')).toBeNull();
    expect(getByText('Pay with saved card')).toBeTruthy();
    await fireEvent.press(getByText('Purchase'));
    expect(purchase.mutate).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-1', useHostedCheckout: true }), expect.anything());
  });

  it('Decision 441: a monthly plan there says later months go on the balance, and is bought as a Cash/Bank order', async () => {
    mocked(academyQueries.useAcademy).mockReturnValue({ data: { cardPayments: false, inBrazil: true } });
    const monthly = { ...CLASS_PACK, type: 'SUBSCRIPTION', classesIncluded: null, cardSurchargeAmount: 0 };
    const { getByTestId, getByText, queryByText } = await render(<MembershipPlanRow plan={monthly as never} schoolId="school-1" />);
    expect(getByTestId('monthly-to-balance').props.children).toBe(
      'You pay the first month now. After that, each month is added to your balance, and you pay it the same way.',
    );
    expect(queryByText('Pay with saved card')).toBeNull();
    await fireEvent.press(getByText('Purchase'));
    expect(purchase.mutate).toHaveBeenCalledWith({ planId: 'plan-1', studentId: undefined }, expect.anything());
  });

  it('Decision 442 item 2: a Stripe account not ready yet is a School without cards, and a card purchase refused says so in the member\'s words', async () => {
    // The School's profile says no cards until Stripe says its account is ready.
    mocked(academyQueries.useAcademy).mockReturnValue({ data: { cardPayments: false, inBrazil: false } });
    const { getByText, getByTestId, queryByText, unmount } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 0 } as never} schoolId="school-1" />);
    expect(getByTestId('no-card-payments')).toBeTruthy();
    expect(queryByText('Pay with saved card')).toBeNull();
    await fireEvent.press(getByText('Purchase'));
    expect(purchase.mutate).toHaveBeenCalledWith({ planId: 'plan-1', studentId: undefined }, expect.anything());
    await unmount();
    // An older screen that still asked for a card gets the API's refusal, in the app's own wording.
    mocked(membershipQueries.usePurchaseMembership).mockReturnValue({
      ...idlePurchase(),
      isError: true,
      error: new ApiError(400, 'CARD_PAYMENTS_NOT_READY', 'Technical text'),
    });
    const { getByText: text } = await render(<MembershipPlanRow plan={{ ...CLASS_PACK, cardSurchargeAmount: 0 } as never} schoolId="school-1" />);
    expect(text("This School can't take card payments yet. Pay at the School instead, by cash or bank transfer, and staff confirm it.")).toBeTruthy();
  });

  it('a monthly plan at a School that takes cards has no balance note', async () => {
    mocked(academyQueries.useAcademy).mockReturnValue({ data: { cardPayments: true, inBrazil: false } });
    const monthly = { ...CLASS_PACK, type: 'SUBSCRIPTION', classesIncluded: null, cardSurchargeAmount: 0 };
    const { queryByTestId } = await render(<MembershipPlanRow plan={monthly as never} schoolId="school-1" />);
    expect(queryByTestId('monthly-to-balance')).toBeNull();
  });
});
