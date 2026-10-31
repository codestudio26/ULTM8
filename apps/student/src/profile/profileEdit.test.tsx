import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as q from './profileQueries';
import { ProfileScreen } from './ProfileScreen';

jest.mock('./profileQueries', () => ({
  useMyProfile: jest.fn(),
  useUpdateProfile: jest.fn(),
  useUploadMyProfilePhoto: jest.fn(),
  useLanguages: jest.fn(),
  useCurrencies: jest.fn(),
}));
// Google Places street lookup: switched off here (no key), so no search box.
jest.mock('./addressLookupQueries', () => ({
  useAddressLookupStatus: () => ({ data: { enabled: false } }),
  fetchAddressSuggestions: jest.fn(),
  fetchAddressDetails: jest.fn(),
  newSessionToken: () => 'tok',
}));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const idleMutation = () => ({ mutate: jest.fn(), isPending: false, isError: false, error: null });

const PROFILE = {
  id: 'student-1',
  email: 'student@example.test',
  phone: '+15551234567',
  phoneVerifiedAt: '2026-01-01T00:00:00.000Z',
  firstName: 'Jamie',
  surname: 'Lee',
  dateOfBirth: '2010-05-01T00:00:00.000Z',
  username: 'jamie-lee',
  gender: 'FEMALE',
  nationality: 'Testland',
  address: '123 Test St',
  weightCategory: '-73kg',
  kimonoSize: 'A3',
  beltSize: '3',
  language: 'en',
  currency: 'USD',
};

/**
 * Task #37 — closes the undefined-vs-null DTO contract gap for ProfileScreen's
 * own plain-text fields. Mirrors paymentMethods.test.tsx's own house style:
 * mock every query module entirely, inline fixtures, render + fireEvent (both
 * awaited), no real react-query/network.
 */
describe('ProfileScreen — clearing a field sends null, not undefined', () => {
  let updateProfile: ReturnType<typeof idleMutation>;

  beforeEach(() => {
    jest.clearAllMocks();
    updateProfile = idleMutation();
    mocked(q.useMyProfile).mockReturnValue({ data: PROFILE, isLoading: false, isError: false, error: null });
    mocked(q.useUpdateProfile).mockReturnValue(updateProfile);
    mocked(q.useUploadMyProfilePhoto).mockReturnValue(idleMutation());
    mocked(q.useLanguages).mockReturnValue({ data: [{ code: 'en', name: 'English' }], isLoading: false });
    mocked(q.useCurrencies).mockReturnValue({ data: [{ code: 'USD', name: 'US Dollar' }], isLoading: false });
  });

  it('choosing "Not given" for gender and saving sends gender: null', async () => {
    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Not given'));
    await fireEvent.press(getByText('Save'));

    expect(updateProfile.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ gender: null }),
      expect.anything(),
    );
  });

  it('clearing nationality/username/address/weightCategory/kimonoSize/beltSize to empty sends null for each', async () => {
    const { getByDisplayValue, getByText } = await render(<ProfileScreen />);
    await fireEvent.changeText(getByDisplayValue('Testland'), '');
    await fireEvent.changeText(getByDisplayValue('jamie-lee'), '');
    await fireEvent.changeText(getByDisplayValue('123 Test St'), '');
    await fireEvent.changeText(getByDisplayValue('-73kg'), '');
    await fireEvent.changeText(getByDisplayValue('A3'), '');
    await fireEvent.changeText(getByDisplayValue('3'), '');
    await fireEvent.press(getByText('Save'));

    expect(updateProfile.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        nationality: null,
        username: null,
        address: null,
        weightCategory: null,
        kimonoSize: null,
        beltSize: null,
      }),
      expect.anything(),
    );
  });

  it('leaving a field untouched never sends null for it', async () => {
    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Save'));

    const call = updateProfile.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.gender).toBe('FEMALE');
    expect(call.nationality).toBe('Testland');
    expect(call.username).toBe('jamie-lee');
  });

  it('an untouched address is left out, so a structured address saved elsewhere is kept', async () => {
    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Save'));

    const call = updateProfile.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.address).toBeUndefined();
  });

  it('language/currency still send undefined, not null, when left at their current value (no clear option exists for either)', async () => {
    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Save'));

    const call = updateProfile.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.language).toBe('en');
    expect(call.currency).toBe('USD');
  });

  it('sends only the contacts that changed (Decision 315 item 5), blank clearing one', async () => {
    mocked(q.useMyProfile).mockReturnValue({ data: { ...PROFILE, emergencyContactName: 'Ma', secondaryEmail: 'old@example.test' }, isLoading: false, isError: false, error: null });
    const { getByDisplayValue, getByText } = await render(<ProfileScreen />);
    await fireEvent.changeText(getByDisplayValue('old@example.test'), '');
    await fireEvent.changeText(getByDisplayValue('Ma'), 'Mum');
    await fireEvent.press(getByText('Save'));

    const call = updateProfile.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.secondaryEmail).toBeNull();
    expect(call.emergencyContactName).toBe('Mum');
    expect('secondaryPhone' in call).toBe(false);
    expect('emergencyContactRelationship' in call).toBe(false);
  });
});
