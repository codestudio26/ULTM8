import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ApiError } from '@ultm8/api-client';
import * as q from './medicalInfoQueries';
import { MedicalInfoSharing } from './MedicalInfoSharing';

jest.mock('./medicalInfoQueries', () => ({ useMedicalInfoShared: jest.fn(), useWithdrawMedicalInfo: jest.fn() }));

// The first render loads every React Native component this uses; on a busy
// CI runner that alone can pass jest's default 5 s.
jest.setTimeout(30_000);

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const withdraw = jest.fn();

const ITEM = { schoolId: 'dojo', schoolName: 'Alpha Dojo', consentedAt: '2026-10-01T10:00:00.000Z', consentedByGuardian: false, awaitingAcceptance: false };

beforeEach(() => {
  jest.clearAllMocks();
  mocked(q.useWithdrawMedicalInfo).mockReturnValue({ mutate: withdraw, isPending: false, isError: false, error: null });
});

describe('MedicalInfoSharing (Decision 419 item 1)', () => {
  it('shows each School that holds it and withdraws consent only after confirming', async () => {
    mocked(q.useMedicalInfoShared).mockReturnValue({ data: { items: [ITEM] }, isLoading: false, isError: false, error: null });
    const screen = await render(<MedicalInfoSharing studentId="me" />);

    expect(mocked(q.useMedicalInfoShared)).toHaveBeenCalledWith('me');
    expect(screen.getByText('Medical information: shared with Alpha Dojo')).toBeTruthy();
    expect(screen.getByText(/^Consent given on /)).toBeTruthy();

    await fireEvent.press(screen.getByText('Withdraw consent'));
    expect(withdraw).not.toHaveBeenCalled();
    expect(screen.getByText(/Alpha Dojo's copy of this medical information is deleted at once/)).toBeTruthy();

    // Cancel keeps it.
    await fireEvent.press(screen.getByText('Cancel'));
    expect(withdraw).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Withdraw consent'));
    await fireEvent.press(screen.getByText('Withdraw'));
    expect(withdraw).toHaveBeenCalledWith('dojo');
  });

  it('marks medical information still waiting on a sign-up invite', async () => {
    mocked(q.useMedicalInfoShared).mockReturnValue({ data: { items: [{ ...ITEM, awaitingAcceptance: true }] }, isLoading: false, isError: false, error: null });
    const screen = await render(<MedicalInfoSharing studentId="me" />);
    expect(screen.getByText(/kept until you accept or decline the School's invite/)).toBeTruthy();
  });

  it('shows nothing when no School holds any, or for a child (the API refuses)', async () => {
    mocked(q.useMedicalInfoShared).mockReturnValue({ data: { items: [] }, isLoading: false, isError: false, error: null });
    expect((await render(<MedicalInfoSharing studentId="me" />)).queryByText('Medical information')).toBeNull();

    mocked(q.useMedicalInfoShared).mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new ApiError(403, 'FORBIDDEN', 'No') });
    const child = await render(<MedicalInfoSharing studentId="kid" />);
    expect(child.queryByText('Medical information')).toBeNull();
    expect(child.queryByText(/Could not load/)).toBeNull();
  });

  it('says so when it could not load', async () => {
    mocked(q.useMedicalInfoShared).mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('network') });
    const screen = await render(<MedicalInfoSharing studentId="me" />);
    expect(screen.getByText(/Could not load your medical information|network/)).toBeTruthy();
  });
});
