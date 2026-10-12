import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as membershipQueries from './membershipQueries';
import * as paymentMethodQueries from '../payments/paymentMethodQueries';
import * as stepUpQueries from '../auth/stepUpQueries';
import { MembershipPlanRow } from './MembershipPlanRow';

jest.mock('./membershipQueries', () => ({ usePurchaseMembership: jest.fn() }));
jest.mock('../payments/paymentMethodQueries', () => ({ usePaymentMethod: jest.fn() }));
jest.mock('../auth/stepUpQueries', () => ({ useVerifyStepUp: jest.fn() }));

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

  beforeEach(() => {
    jest.clearAllMocks();
    purchase = idlePurchase();
    verifyStepUp = mkVerifyStepUp();
    mocked(membershipQueries.usePurchaseMembership).mockReturnValue(purchase);
    mocked(stepUpQueries.useVerifyStepUp).mockReturnValue(verifyStepUp);
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

  it('"Purchase" still sends a plain, fresh-card request — no payWithSavedCard, no step-up', async () => {
    mocked(paymentMethodQueries.usePaymentMethod).mockReturnValue({ data: { hasSavedPaymentMethod: true } } as never);

    const { getByText } = await render(<MembershipPlanRow plan={CLASS_PACK as never} schoolId="school-1" />);
    await fireEvent.press(getByText('Purchase'));

    expect(verifyStepUp.mutate).not.toHaveBeenCalled();
    expect(purchase.mutate).toHaveBeenCalledWith({ planId: 'plan-1' });
  });
});
