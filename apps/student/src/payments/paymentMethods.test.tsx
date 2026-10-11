import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as auth from '../auth/AuthContext';
import * as waiverQueries from '../waivers/waiverQueries';
import * as WebBrowser from 'expo-web-browser';
import * as q from './paymentMethodQueries';
import { PaymentMethodsScreen } from './PaymentMethodsScreen';

jest.mock('../auth/AuthContext', () => ({ useEnrolledSchoolIds: jest.fn() }));
jest.mock('../waivers/waiverQueries', () => ({ useEnrolledSchoolNames: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('./paymentMethodQueries', () => ({
  usePaymentMethodsForSchools: jest.fn(),
  useCreateSetupSession: jest.fn(),
  useDeletePaymentMethod: jest.fn(),
}));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const idleMutation = () => ({ mutateAsync: jest.fn<() => Promise<unknown>>(), isPending: false });

/**
 * Decision 234's own saved-payment-method dependency. Mirrors joinSchool.test.tsx's
 * own house style: mock every query/native module entirely, inline fixtures, render
 * + fireEvent (both awaited), no real react-query/network/Expo runtime.
 */
describe('PaymentMethodsScreen — Decision 234', () => {
  let refetch: jest.Mock;
  let createSetupSession: ReturnType<typeof idleMutation>;
  let deletePaymentMethod: ReturnType<typeof idleMutation>;

  beforeEach(() => {
    jest.clearAllMocks();
    refetch = jest.fn();
    createSetupSession = idleMutation();
    deletePaymentMethod = idleMutation();
    mocked(waiverQueries.useEnrolledSchoolNames).mockReturnValue(new Map([['school-1', 'Alpha Dojo']]));
    mocked(q.useCreateSetupSession).mockReturnValue(createSetupSession);
    mocked(q.useDeletePaymentMethod).mockReturnValue(deletePaymentMethod);
  });

  it('shows a fallback message when the Student is not enrolled anywhere', async () => {
    mocked(auth.useEnrolledSchoolIds).mockReturnValue([]);
    mocked(q.usePaymentMethodsForSchools).mockReturnValue([]);

    const { getByText } = await render(<PaymentMethodsScreen />);
    expect(getByText(/not enrolled at a School yet/)).toBeTruthy();
  });

  it('shows "No card saved" and only an Add-card button when nothing is saved', async () => {
    mocked(auth.useEnrolledSchoolIds).mockReturnValue(['school-1']);
    mocked(q.usePaymentMethodsForSchools).mockReturnValue([
      { data: { hasSavedPaymentMethod: false }, isLoading: false, error: null, refetch },
    ]);

    const { getByText, queryByText } = await render(<PaymentMethodsScreen />);
    expect(getByText('Alpha Dojo')).toBeTruthy();
    expect(getByText('No card saved.')).toBeTruthy();
    expect(getByText('Add card')).toBeTruthy();
    expect(queryByText('Remove')).toBeNull();
  });

  it('shows the card brand/last4 and both Update/Remove buttons when one is saved', async () => {
    mocked(auth.useEnrolledSchoolIds).mockReturnValue(['school-1']);
    mocked(q.usePaymentMethodsForSchools).mockReturnValue([
      { data: { hasSavedPaymentMethod: true, brand: 'visa', last4: '4242' }, isLoading: false, error: null, refetch },
    ]);

    const { getByText } = await render(<PaymentMethodsScreen />);
    expect(getByText('VISA •••• 4242')).toBeTruthy();
    expect(getByText('Update card')).toBeTruthy();
    expect(getByText('Remove')).toBeTruthy();
  });

  it('tapping Add card opens the hosted Checkout URL, then refetches this School\'s status', async () => {
    mocked(auth.useEnrolledSchoolIds).mockReturnValue(['school-1']);
    mocked(q.usePaymentMethodsForSchools).mockReturnValue([
      { data: { hasSavedPaymentMethod: false }, isLoading: false, error: null, refetch },
    ]);
    createSetupSession.mutateAsync.mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_1' });
    mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: 'dismiss' } as never);

    const { getByText } = await render(<PaymentMethodsScreen />);
    await fireEvent.press(getByText('Add card'));

    await waitFor(() => {
      expect(createSetupSession.mutateAsync).toHaveBeenCalled();
      expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith('https://checkout.stripe.com/pay/cs_1', 'ultm8-student://payment-methods/complete');
      expect(refetch).toHaveBeenCalled();
    });
  });

  it('tapping Remove calls the delete mutation', async () => {
    mocked(auth.useEnrolledSchoolIds).mockReturnValue(['school-1']);
    mocked(q.usePaymentMethodsForSchools).mockReturnValue([
      { data: { hasSavedPaymentMethod: true, brand: 'visa', last4: '4242' }, isLoading: false, error: null, refetch },
    ]);

    const { getByText } = await render(<PaymentMethodsScreen />);
    await fireEvent.press(getByText('Remove'));

    await waitFor(() => expect(deletePaymentMethod.mutateAsync).toHaveBeenCalled());
  });
});
