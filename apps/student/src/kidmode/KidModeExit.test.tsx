import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { KidModeBookingScreen } from './KidModeBookingScreen';

jest.mock('./kidModePinStore', () => ({ getKidModePin: jest.fn(async () => '1234') }));
jest.mock('../guardians/guardianQueries', () => ({ useMyMinors: jest.fn(() => ({ isLoading: false, data: { items: [] } })) }));
jest.mock('../guardians/bookingDelegationQueries', () => ({
  useMyBookingDelegations: jest.fn(() => ({ isLoading: false, isError: false, data: { items: [] } })),
  useMintKidModeToken: jest.fn(() => ({ mutateAsync: jest.fn() })),
}));
jest.mock('../academies/academyQueries', () => ({ useAcademies: jest.fn(() => ({ data: undefined })), useAcademy: jest.fn(() => ({ data: undefined })) }));
jest.mock('./kidModeClient', () => ({ bookClassAsKidMode: jest.fn() }));

jest.setTimeout(30_000);

type Listener = (e: { preventDefault: () => void }) => void;

function fakeNavigation() {
  let listener: Listener | undefined;
  return {
    addListener: jest.fn((_event: string, l: Listener) => {
      listener = l;
      return () => undefined;
    }),
    goBack: jest.fn(() => {
      const e = { preventDefault: jest.fn() };
      listener?.(e);
      return e;
    }),
    tryLeave() {
      const e = { preventDefault: jest.fn() };
      listener?.(e);
      return e;
    },
  };
}

/** Decision 427 — Student portal review SP7: leaving Kid Mode needs the PIN. */
describe('Kid Mode — locked door', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stops Back and asks for the PIN', async () => {
    const navigation = fakeNavigation();
    const screen = await render(<KidModeBookingScreen navigation={navigation as never} route={{} as never} />);
    const e = navigation.tryLeave();
    expect(e.preventDefault).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Parent's PIN to exit")).toBeTruthy());
  });

  it('refuses a wrong PIN and lets the parent out with the right one', async () => {
    const navigation = fakeNavigation();
    const screen = await render(<KidModeBookingScreen navigation={navigation as never} route={{} as never} />);
    await fireEvent.press(screen.getByText('Exit Kid Mode'));
    await fireEvent.changeText(screen.getByLabelText("Parent's PIN to exit"), '9999');
    await fireEvent.press(screen.getByText('Exit'));
    await waitFor(() => expect(screen.getByText('Incorrect PIN.')).toBeTruthy());
    expect(navigation.goBack).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText("Parent's PIN to exit"), '1234');
    await fireEvent.press(screen.getByText('Exit'));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    const left = navigation.goBack.mock.results[0]!.value as { preventDefault: jest.Mock };
    expect(left.preventDefault).not.toHaveBeenCalled();
  });
});
