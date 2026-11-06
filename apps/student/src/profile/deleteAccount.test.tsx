import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ApiError } from '@ultm8/api-client';
import * as q from './accountDeletionQueries';
import * as stepUpQueries from '../auth/stepUpQueries';
import * as auth from '../auth/AuthContext';
import { DeleteAccountScreen } from './DeleteAccountScreen';

jest.mock('./accountDeletionQueries', () => ({ useAccountDeletionPreview: jest.fn(), useRequestAccountDeletion: jest.fn() }));
jest.mock('../auth/stepUpQueries', () => ({ useVerifyStepUp: jest.fn() }));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

jest.setTimeout(30_000);

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const logout = jest.fn();
const requestMutate = jest.fn();

const STATE = {
  pending: false,
  requestedAt: null,
  dueAt: null,
  graceDays: 30,
  blockedBy: [],
  childrenDeleted: [{ studentId: 'kid-1', firstName: 'Ana', surname: 'Silva' }],
  childrenKept: [{ studentId: 'kid-2', firstName: 'Leo', surname: 'Silva', reason: 'OTHER_PARENT' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked(auth.useAuth).mockReturnValue({ logout });
  mocked(q.useRequestAccountDeletion).mockReturnValue({ mutate: requestMutate, isPending: false, isError: false, error: null });
  mocked(stepUpQueries.useVerifyStepUp).mockReturnValue({
    mutate: jest.fn((_passcode: string, opts?: { onSuccess?: (data: { stepUpToken: string }) => void }) => opts?.onSuccess?.({ stepUpToken: 'proof-1' })),
    isPending: false,
    isError: false,
    error: null,
  });
});

describe('Delete my account', () => {
  it('says what happens, names the children deleted too, and asks for the passcode before deleting', async () => {
    mocked(q.useAccountDeletionPreview).mockReturnValue({ data: STATE, isLoading: false, isError: false, error: null });
    const screen = await render(<DeleteAccountScreen />);

    expect(screen.getByText(/deleted for good after 30 days/)).toBeTruthy();
    expect(screen.getByText(/You'll show as "Erased User"/)).toBeTruthy();
    expect(screen.getByText('These children will be deleted too')).toBeTruthy();
    expect(screen.getByText('Ana Silva')).toBeTruthy();
    expect(screen.getByText('Leo Silva: another parent is linked. Only your link ends.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Delete my account'));
    expect(requestMutate).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('step-up-passcode-input'), '123456');
    await fireEvent.press(screen.getByText('Confirm'));
    expect(requestMutate).toHaveBeenCalledWith('proof-1', expect.anything());
  });

  it('after asking, shows when it becomes final and signs out', async () => {
    mocked(q.useAccountDeletionPreview).mockReturnValue({ data: STATE, isLoading: false, isError: false, error: null });
    requestMutate.mockImplementation((_token: unknown, opts: unknown) =>
      (opts as { onSuccess: (r: unknown) => void }).onSuccess({ ...STATE, pending: true, requestedAt: '2026-11-06T10:00:00.000Z', dueAt: '2026-12-06T10:00:00.000Z' }),
    );
    const screen = await render(<DeleteAccountScreen />);
    await fireEvent.press(screen.getByText('Delete my account'));
    await fireEvent.changeText(screen.getByTestId('step-up-passcode-input'), '123456');
    await fireEvent.press(screen.getByText('Confirm'));
    expect(screen.getByText(/^Your account will be deleted on /)).toBeTruthy();
    expect(screen.getByText('Deleted with it: Ana Silva.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Sign out'));
    expect(logout).toHaveBeenCalled();
  });

  it('the main owner of an open School is told to hand it over or close it, with no delete button', async () => {
    mocked(q.useAccountDeletionPreview).mockReturnValue({
      data: { ...STATE, childrenDeleted: [], childrenKept: [], blockedBy: [{ kind: 'SCHOOL', id: 's1', name: 'Alpha Dojo' }] },
      isLoading: false,
      isError: false,
      error: null,
    });
    const screen = await render(<DeleteAccountScreen />);
    expect(screen.getByText("You can't delete your account yet")).toBeTruthy();
    expect(screen.getByText(/You're the main owner of Alpha Dojo\./)).toBeTruthy();
    expect(screen.queryByText('Delete my account')).toBeNull();
  });

  it("shows the API's coded refusal in the app's own words", async () => {
    mocked(q.useAccountDeletionPreview).mockReturnValue({ data: { ...STATE, childrenDeleted: [], childrenKept: [] }, isLoading: false, isError: false, error: null });
    mocked(q.useRequestAccountDeletion).mockReturnValue({
      mutate: requestMutate,
      isPending: false,
      isError: true,
      error: new ApiError(503, 'SUBSCRIPTION_NOT_STOPPED', 'server text'),
    });
    const screen = await render(<DeleteAccountScreen />);
    expect(screen.getByText(/couldn't stop a recurring payment just now/)).toBeTruthy();
  });
});
