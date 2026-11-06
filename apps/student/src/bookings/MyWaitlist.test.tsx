import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as waitlistMutations from './waitlistMutations';
import { MyWaitlist } from './MyWaitlist';

jest.mock('./waitlistMutations', () => ({
  useMyWaitlist: jest.fn(),
  useClaimWaitlist: jest.fn(),
  useWithdrawWaitlist: jest.fn(),
}));

jest.setTimeout(30_000);

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const idleMutation = () => ({ mutateAsync: jest.fn<(...args: unknown[]) => Promise<unknown>>(), isPending: false });

const ENTRY = {
  id: 'entry-1', classId: 'class-1', schoolId: 'school-1', position: 1, claimByDeadline: null,
  classTitle: 'Advanced No-Gi', classStartsAt: '2026-11-07T19:00:00.000Z', schoolName: 'Alpha Dojo',
};

/** Decision 427 — Student portal review SP3: a freed spot can be claimed. */
describe('MyWaitlist', () => {
  let claim: ReturnType<typeof idleMutation>;

  beforeEach(() => {
    jest.clearAllMocks();
    claim = idleMutation();
    mocked(waitlistMutations.useClaimWaitlist).mockReturnValue(claim);
    mocked(waitlistMutations.useWithdrawWaitlist).mockReturnValue(idleMutation());
  });

  it('shows nothing when not waiting for anything', async () => {
    mocked(waitlistMutations.useMyWaitlist).mockReturnValue({ data: { items: [] } });
    const screen = await render(<MyWaitlist />);
    expect(screen.queryByText('My waitlist')).toBeNull();
  });

  it('shows the place while waiting, with no Claim button', async () => {
    mocked(waitlistMutations.useMyWaitlist).mockReturnValue({ data: { items: [{ ...ENTRY, status: 'WAITING', position: 2 }] } });
    const screen = await render(<MyWaitlist />);
    expect(screen.getByText('Advanced No-Gi')).toBeTruthy();
    expect(screen.getByText("You're #2 on the waitlist.")).toBeTruthy();
    expect(screen.queryByText('Claim spot')).toBeNull();
  });

  it('claims a freed spot', async () => {
    mocked(waitlistMutations.useMyWaitlist).mockReturnValue({ data: { items: [{ ...ENTRY, status: 'NOTIFIED', claimByDeadline: '2026-11-06T19:00:00.000Z' }] } });
    claim.mutateAsync.mockResolvedValue({ id: 'booking-1' });
    const screen = await render(<MyWaitlist />);
    expect(screen.getByText(/A spot is free for you\. Claim it by /)).toBeTruthy();
    await fireEvent.press(screen.getByText('Claim spot'));
    await waitFor(() => expect(claim.mutateAsync).toHaveBeenCalledWith('entry-1'));
  });

  it('shows the reason when the claim fails', async () => {
    const { ApiError } = jest.requireActual<typeof import('@ultm8/api-client')>('@ultm8/api-client');
    mocked(waitlistMutations.useMyWaitlist).mockReturnValue({ data: { items: [{ ...ENTRY, status: 'NOTIFIED' }] } });
    claim.mutateAsync.mockRejectedValue(new ApiError(409, 'CONFLICT', "This Waitlist entry's claim window has passed."));
    const screen = await render(<MyWaitlist />);
    await fireEvent.press(screen.getByText('Claim spot'));
    await waitFor(() => expect(screen.getByText("This Waitlist entry's claim window has passed.")).toBeTruthy());
  });
});

/** Decision 442 item 1: a claim refused for want of a signed waiver. */
describe('MyWaitlist — Sign the waiver', () => {
  it("offers \"Sign the waiver\" for that School when the claim needs a waiver", async () => {
    const { ApiError } = jest.requireActual<typeof import('@ultm8/api-client')>('@ultm8/api-client');
    mockNavigate.mockClear();
    const claim = idleMutation();
    mocked(waitlistMutations.useClaimWaitlist).mockReturnValue(claim);
    mocked(waitlistMutations.useWithdrawWaitlist).mockReturnValue(idleMutation());
    mocked(waitlistMutations.useMyWaitlist).mockReturnValue({ data: { items: [{ ...ENTRY, status: 'NOTIFIED' }] } });
    claim.mutateAsync.mockRejectedValue(new ApiError(403, 'WAIVER_REQUIRED', 'This School needs a signed waiver before booking a class or checking in.'));
    const screen = await render(<MyWaitlist />);
    await fireEvent.press(screen.getByText('Claim spot'));
    await waitFor(() => expect(screen.getByText('This School needs a signed waiver before booking a class or checking in.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Sign the waiver'));
    expect(mockNavigate).toHaveBeenCalledWith('Waivers', { schoolId: 'school-1' });
  });
});
