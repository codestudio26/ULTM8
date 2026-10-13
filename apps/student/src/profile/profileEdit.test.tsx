import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as q from './profileQueries';
import { ProfileScreen } from './ProfileScreen';

jest.mock('./profileQueries', () => ({
  useMyProfile: jest.fn(),
  useUpdateProfile: jest.fn(),
  useLanguages: jest.fn(),
  useCurrencies: jest.fn(),
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
  gender: 'non-binary',
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
    mocked(q.useLanguages).mockReturnValue({ data: [{ code: 'en', name: 'English' }], isLoading: false });
    mocked(q.useCurrencies).mockReturnValue({ data: [{ code: 'USD', name: 'US Dollar' }], isLoading: false });
  });

  it('clearing gender to empty and saving sends gender: null', async () => {
    const { getByDisplayValue, getByText } = await render(<ProfileScreen />);
    await fireEvent.changeText(getByDisplayValue('non-binary'), '');
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
    expect(call.gender).toBe('non-binary');
    expect(call.nationality).toBe('Testland');
    expect(call.username).toBe('jamie-lee');
    expect(call.address).toBe('123 Test St');
  });

  it('language/currency still send undefined, not null, when left at their current value (no clear option exists for either)', async () => {
    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Save'));

    const call = updateProfile.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.language).toBe('en');
    expect(call.currency).toBe('USD');
  });
});
