import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@ultm8/api-client';
import * as auth from './AuthContext';
import { ChangePasscodeScreen } from './ChangePasscodeScreen';

jest.mock('./AuthContext', () => ({ useAuth: jest.fn() }));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

/** Decision 428 (Student portal review M3). */
describe('ChangePasscodeScreen', () => {
  let changePasscode: jest.Mock<(current: string, next: string) => Promise<void>>;

  beforeEach(() => {
    changePasscode = jest.fn<(current: string, next: string) => Promise<void>>();
    mocked(auth.useAuth).mockReturnValue({ changePasscode });
  });

  async function fill(screen: Awaited<ReturnType<typeof render>>, current: string, next: string, confirm: string) {
    await fireEvent.changeText(screen.getByLabelText('Current passcode'), current);
    await fireEvent.changeText(screen.getByLabelText('New passcode'), next);
    await fireEvent.changeText(screen.getByLabelText('Confirm new passcode'), confirm);
  }

  it('changes the passcode and says so', async () => {
    changePasscode.mockResolvedValue();
    const screen = await render(<ChangePasscodeScreen />);
    await fill(screen, '111111', '222222', '222222');
    await fireEvent.press(screen.getAllByText('Change passcode').at(-1)!);
    await waitFor(() => expect(screen.getByText('Passcode changed. Your other devices are signed out.')).toBeTruthy());
    expect(changePasscode).toHaveBeenCalledWith('111111', '222222');
  });

  it("stops when the new passcode and confirmation don't match", async () => {
    const screen = await render(<ChangePasscodeScreen />);
    await fill(screen, '111111', '222222', '333333');
    await fireEvent.press(screen.getAllByText('Change passcode').at(-1)!);
    expect(screen.getByText('New passcode and confirmation must match.')).toBeTruthy();
    expect(changePasscode).not.toHaveBeenCalled();
  });

  it("shows the API's message for a wrong current passcode", async () => {
    changePasscode.mockRejectedValue(new ApiError(400, 'BAD_REQUEST', 'Your current passcode is not right.'));
    const screen = await render(<ChangePasscodeScreen />);
    await fill(screen, '999999', '222222', '222222');
    await fireEvent.press(screen.getAllByText('Change passcode').at(-1)!);
    await waitFor(() => expect(screen.getByText('Your current passcode is not right.')).toBeTruthy());
  });
});
