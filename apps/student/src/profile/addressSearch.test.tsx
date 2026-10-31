import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as q from './profileQueries';
import * as lookup from './addressLookupQueries';
import { ProfileScreen } from './ProfileScreen';

jest.mock('./profileQueries', () => ({
  useMyProfile: jest.fn(),
  useUpdateProfile: jest.fn(),
  useUploadMyProfilePhoto: jest.fn(),
  useLanguages: jest.fn(),
  useCurrencies: jest.fn(),
}));
jest.mock('./addressLookupQueries', () => ({
  useAddressLookupStatus: jest.fn(),
  fetchAddressSuggestions: jest.fn(),
  fetchAddressDetails: jest.fn(),
  newSessionToken: jest.fn(() => 'tok-1'),
}));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock<(...args: any[]) => any>;
const idleMutation = () => ({ mutate: jest.fn(), isPending: false, isError: false, error: null });

const PROFILE = {
  id: 'student-1',
  email: 'student@example.test',
  phone: '+15551234567',
  firstName: 'Jamie',
  surname: 'Lee',
  dateOfBirth: '2010-05-01T00:00:00.000Z',
  address: '123 Test St',
  language: 'en',
  currency: 'USD',
};

const UK = { line1: '10 Downing Street', line2: '', city: 'London', region: '', postalCode: 'SW1A 2AA', country: 'GB' };

/** Google Places street lookup on My Profile (Decision 212). Network calls are mocked. */
describe('ProfileScreen — Search address', () => {
  let updateProfile: ReturnType<typeof idleMutation>;

  beforeEach(() => {
    jest.clearAllMocks();
    updateProfile = idleMutation();
    mocked(q.useMyProfile).mockReturnValue({ data: PROFILE, isLoading: false, isError: false, error: null });
    mocked(q.useUpdateProfile).mockReturnValue(updateProfile);
    mocked(q.useUploadMyProfilePhoto).mockReturnValue(idleMutation());
    mocked(q.useLanguages).mockReturnValue({ data: [{ code: 'en', name: 'English' }], isLoading: false });
    mocked(q.useCurrencies).mockReturnValue({ data: [{ code: 'USD', name: 'US Dollar' }], isLoading: false });
    mocked(lookup.useAddressLookupStatus).mockReturnValue({ data: { enabled: true } });
    mocked(lookup.fetchAddressSuggestions).mockResolvedValue([
      { placeId: 'p1', text: '10 Downing Street, London, UK', mainText: '10 Downing Street', secondaryText: 'London, UK' },
    ]);
    mocked(lookup.fetchAddressDetails).mockResolvedValue({
      placeId: 'p1',
      postalAddress: UK,
      formattedAddress: '10 Downing Street, London, SW1A 2AA, United Kingdom',
      complete: true,
    });
  });

  it('is hidden while the lookup is switched off', async () => {
    mocked(lookup.useAddressLookupStatus).mockReturnValue({ data: { enabled: false } });
    const { queryByLabelText } = await render(<ProfileScreen />);
    expect(queryByLabelText('Search address')).toBeNull();
  });

  it('fills the address from a result and saves it with its separate fields', async () => {
    const { getByLabelText, findByText, getByDisplayValue, getByText } = await render(<ProfileScreen />);
    await fireEvent.changeText(getByLabelText('Search address'), '10 Down');
    const option = await findByText('10 Downing Street', {}, { timeout: 2000 });
    expect(getByText('Powered by Google')).toBeTruthy();
    expect(lookup.fetchAddressSuggestions).toHaveBeenCalledWith({ q: '10 Down', sessionToken: 'tok-1', language: expect.any(String) });
    await act(async () => {
      fireEvent.press(option);
    });
    await waitFor(() => expect(getByDisplayValue('10 Downing Street, London, SW1A 2AA, United Kingdom')).toBeTruthy());
    expect(lookup.fetchAddressDetails).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'p1', sessionToken: 'tok-1' }));

    await fireEvent.press(getByText('Save'));
    const call = updateProfile.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.postalAddress).toEqual(UK);
    expect('address' in call).toBe(false);
  });

  it('saves plain text once the looked-up address is edited', async () => {
    const { getByLabelText, findByText, getByDisplayValue, getByText } = await render(<ProfileScreen />);
    await fireEvent.changeText(getByLabelText('Search address'), '10 Down');
    const option = await findByText('10 Downing Street', {}, { timeout: 2000 });
    await act(async () => {
      fireEvent.press(option);
    });
    const field = await waitFor(() => getByDisplayValue('10 Downing Street, London, SW1A 2AA, United Kingdom'));
    await fireEvent.changeText(field, '10 Downing Street, London');
    await fireEvent.press(getByText('Save'));
    const call = updateProfile.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.address).toBe('10 Downing Street, London');
    expect(call.postalAddress).toBeUndefined();
  });
});
