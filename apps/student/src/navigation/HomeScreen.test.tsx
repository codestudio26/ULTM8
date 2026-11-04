import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as auth from '../auth/AuthContext';
import { HomeScreen } from './HomeScreen';

jest.mock('../auth/AuthContext', () => ({
  useAuth: jest.fn(),
  useCoachSchoolId: jest.fn(() => null),
  useEnrolledSchoolIds: jest.fn(() => []),
  useIsGuardian: jest.fn(() => false),
}));
jest.mock('../guardians/guardianQueries', () => ({ useMyMinors: jest.fn(() => ({ data: undefined })) }));
jest.mock('../grading/HomeFeeCards', () => ({ HomeFeeCards: () => null }));
jest.mock('../academies/SignUpInvites', () => ({ SignUpInvites: () => null }));
jest.mock('../academies/ChildInvites', () => ({ ChildInvites: () => null }));
jest.mock('../memberships/PackRechargeCards', () => ({ PackRechargeCards: () => null }));
jest.mock('../components/LegalFooter', () => ({ LegalFooter: () => null }));

jest.setTimeout(30_000);

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const PICK = { id: 'dojo', name: 'Alpha Dojo' };

function setAuth(overrides: Record<string, unknown> = {}) {
  const value = { logout: jest.fn(), claims: { sub: 'me', grants: [] }, pendingSchoolPick: null, clearPendingSchoolPick: jest.fn(), ...overrides };
  mocked(auth.useAuth).mockReturnValue(value);
  return value;
}

const nav = () => ({ navigate: jest.fn() });

/** Decision 427 — Student portal review SP1 and SP2. */
describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked(auth.useEnrolledSchoolIds).mockReturnValue([]);
    mocked(auth.useIsGuardian).mockReturnValue(false);
  });

  it('offers the School picked on first launch as a card, not a forced screen', async () => {
    setAuth({ pendingSchoolPick: PICK });
    const navigation = nav();
    const screen = await render(<HomeScreen navigation={navigation as never} route={{} as never} />);
    expect(screen.getByText('Join Alpha Dojo?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Join'));
    expect(navigation.navigate).toHaveBeenCalledWith('JoinSchool', { academyId: 'dojo', name: 'Alpha Dojo' });
  });

  it('"Not now" forgets the pick', async () => {
    const value = setAuth({ pendingSchoolPick: PICK });
    const screen = await render(<HomeScreen navigation={nav() as never} route={{} as never} />);
    await fireEvent.press(screen.getByText('Not now'));
    expect(value.clearPendingSchoolPick).toHaveBeenCalled();
  });

  it('never asks someone who already works at the picked School', async () => {
    setAuth({ pendingSchoolPick: PICK, claims: { sub: 'me', grants: [{ role: 'INSTRUCTOR', schoolId: 'dojo', franchiseId: null, branchId: null }] } });
    const screen = await render(<HomeScreen navigation={nav() as never} route={{} as never} />);
    expect(screen.queryByText('Join Alpha Dojo?')).toBeNull();
  });

  it('never asks someone already enrolled at the picked School', async () => {
    setAuth({ pendingSchoolPick: PICK });
    mocked(auth.useEnrolledSchoolIds).mockReturnValue(['dojo']);
    const screen = await render(<HomeScreen navigation={nav() as never} route={{} as never} />);
    expect(screen.queryByText('Join Alpha Dojo?')).toBeNull();
  });

  it('shows My minors to everyone, and Kid Mode only to parents', async () => {
    setAuth();
    const screen = await render(<HomeScreen navigation={nav() as never} route={{} as never} />);
    expect(screen.getByText('My minors')).toBeTruthy();
    expect(screen.queryByText('Kid Mode')).toBeNull();

    mocked(auth.useIsGuardian).mockReturnValue(true);
    const parent = await render(<HomeScreen navigation={nav() as never} route={{} as never} />);
    expect(parent.getByText('Kid Mode')).toBeTruthy();
    expect(parent.getByText('Needs your review')).toBeTruthy();
  });
});
