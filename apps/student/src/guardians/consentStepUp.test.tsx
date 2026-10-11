import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as guardianQueries from './guardianQueries';
import * as stepUpQueries from '../auth/stepUpQueries';
import { ConsentTierRow } from './ConsentTierRow';

jest.mock('./guardianQueries', () => ({ useGrantConsent: jest.fn(), useWithdrawConsent: jest.fn() }));
jest.mock('../auth/stepUpQueries', () => ({ useVerifyStepUp: jest.fn() }));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const idleMutation = () => ({ mutate: jest.fn(), data: undefined, isPending: false, isSuccess: false, isError: false, error: null, reset: jest.fn() });

const RECORD = {
  id: 'consent-1',
  guardianId: 'guardian-1',
  studentId: 'student-1',
  tier: 'BASELINE',
  policyVersion: '1.0-placeholder',
  status: 'ACTIVE',
  consentedAt: '2026-01-01T00:00:00.000Z',
  withdrawnAt: null,
};

/**
 * Decision 236 — BASELINE withdrawal must go through StepUpPrompt before the
 * actual withdraw mutation fires; CAMERA must never show that prompt at all.
 * Mirrors coachScreens.test.tsx's own house style: mock every query module
 * entirely, inline fixtures, render + fireEvent (both awaited, per this
 * project's React-19/RTL-v14 convention), no real react-query/network.
 */
describe('ConsentTierRow — Decision 236 step-up gate', () => {
  const mkVerifyStepUp = () => ({
    mutate: jest.fn((_passcode: string, opts?: { onSuccess?: (data: { stepUpToken: string }) => void }) => {
      opts?.onSuccess?.({ stepUpToken: 'step-up-token-abc' });
    }),
    isPending: false,
    isError: false,
    error: null,
  });

  let grant: ReturnType<typeof idleMutation>;
  let withdraw: ReturnType<typeof idleMutation>;
  let verifyStepUp: ReturnType<typeof mkVerifyStepUp>;

  beforeEach(() => {
    jest.clearAllMocks();
    grant = idleMutation();
    withdraw = idleMutation();
    verifyStepUp = mkVerifyStepUp();
    mocked(guardianQueries.useGrantConsent).mockReturnValue(grant);
    mocked(guardianQueries.useWithdrawConsent).mockReturnValue(withdraw);
    mocked(stepUpQueries.useVerifyStepUp).mockReturnValue(verifyStepUp);
  });

  it('BASELINE: tapping Withdraw shows the warning, not the step-up prompt, until acknowledged + confirmed', async () => {
    const { getByText } = await render(<ConsentTierRow studentId="student-1" tier="BASELINE" record={RECORD as never} />);
    await fireEvent.press(getByText('Withdraw'));
    expect(getByText(/deactivates your minor's entire account/)).toBeTruthy();
    // No step-up prompt yet, and no mutation fired — the acknowledge checkbox
    // hasn't been tapped, so "Confirm withdraw" is still disabled.
    expect(withdraw.mutate).not.toHaveBeenCalled();
    expect(verifyStepUp.mutate).not.toHaveBeenCalled();
  });

  it('BASELINE: acknowledging + confirming shows StepUpPrompt instead of withdrawing immediately', async () => {
    const { getByText } = await render(<ConsentTierRow studentId="student-1" tier="BASELINE" record={RECORD as never} />);
    await fireEvent.press(getByText('Withdraw'));
    await fireEvent.press(getByText('I understand this deactivates the account'));
    await fireEvent.press(getByText('Confirm withdraw'));

    // Moved to the step-up prompt — the withdraw mutation must NOT have fired yet.
    expect(withdraw.mutate).not.toHaveBeenCalled();
    expect(getByText('Re-enter your passcode to confirm.')).toBeTruthy();
  });

  it('BASELINE: a correct passcode in StepUpPrompt calls withdraw.mutate WITH the minted step-up token', async () => {
    const { getByText, getByTestId } = await render(
      <ConsentTierRow studentId="student-1" tier="BASELINE" record={RECORD as never} />,
    );
    await fireEvent.press(getByText('Withdraw'));
    await fireEvent.press(getByText('I understand this deactivates the account'));
    await fireEvent.press(getByText('Confirm withdraw'));

    await fireEvent.changeText(getByTestId('step-up-passcode-input'), '424242');
    await fireEvent.press(getByText('Confirm'));

    expect(verifyStepUp.mutate).toHaveBeenCalledWith('424242', expect.anything());
    expect(withdraw.mutate).toHaveBeenCalledWith({ consentRecordId: 'consent-1', stepUpToken: 'step-up-token-abc' });
  });

  it('CAMERA: withdrawal never shows the step-up prompt and mutates directly, without a token', async () => {
    const cameraRecord = { ...RECORD, id: 'consent-2', tier: 'CAMERA' };
    const { getByText, queryByText } = await render(
      <ConsentTierRow studentId="student-1" tier="CAMERA" record={cameraRecord as never} />,
    );
    await fireEvent.press(getByText('Withdraw'));
    // No acknowledge checkbox for CAMERA.
    expect(queryByText('I understand this deactivates the account')).toBeNull();
    await fireEvent.press(getByText('Confirm withdraw'));

    expect(verifyStepUp.mutate).not.toHaveBeenCalled();
    expect(queryByText('Re-enter your passcode to confirm.')).toBeNull();
    expect(withdraw.mutate).toHaveBeenCalledWith({ consentRecordId: 'consent-2' });
  });
});
