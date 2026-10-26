import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as membershipQueries from './membershipQueries';
import { MembershipRow } from './MyMembershipsScreen';

jest.mock('./membershipQueries', () => ({ useCancelSubscription: jest.fn(), useMyMemberships: jest.fn() }));

jest.setTimeout(30_000);

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const SUBSCRIPTION = {
  id: 'm-1', studentId: 's-1', membershipPlanId: 'plan-1', schoolId: 'school-1', status: 'ACTIVE', startDate: '2026-10-01T00:00:00Z',
  frequency: 'RECURRING', classesRemaining: null, expiryDate: null, scopedClassId: null, giftedById: null, cancelAt: null, cancelledById: null,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

/** Decision 348 — a Student cancels their own Subscription; it runs to the
 * end of the paid month, so the row then shows when it ends. */
describe('MembershipRow — cancelling a Subscription', () => {
  let cancel: { mutateAsync: jest.Mock; isPending: boolean };

  beforeEach(() => {
    jest.clearAllMocks();
    cancel = { mutateAsync: jest.fn(async () => ({})), isPending: false };
    mocked(membershipQueries.useCancelSubscription).mockReturnValue(cancel);
  });

  it('asks first, then cancels', async () => {
    const { getByText, queryByText } = await render(<MembershipRow membership={SUBSCRIPTION as never} />);
    await fireEvent.press(getByText('Cancel subscription'));
    expect(getByText(/until the end of the month you have paid for/)).toBeTruthy();
    expect(cancel.mutateAsync).not.toHaveBeenCalled();

    await fireEvent.press(getByText('Keep it'));
    expect(queryByText(/until the end of the month you have paid for/)).toBeNull();

    await fireEvent.press(getByText('Cancel subscription'));
    await fireEvent.press(getByText('Cancel subscription'));
    await waitFor(() => expect(cancel.mutateAsync).toHaveBeenCalledWith('m-1'));
  });

  it('shows when a cancelled Subscription ends, with no Cancel button', async () => {
    const { getByText, queryByText } = await render(<MembershipRow membership={{ ...SUBSCRIPTION, cancelAt: '2030-03-15T12:00:00Z' } as never} />);
    expect(getByText(/Cancelled, ends/)).toBeTruthy();
    expect(queryByText('Cancel subscription')).toBeNull();
  });

  it('offers nothing for a one-time plan', async () => {
    const { queryByText } = await render(<MembershipRow membership={{ ...SUBSCRIPTION, frequency: 'ONE_TIME' } as never} />);
    expect(queryByText('Cancel subscription')).toBeNull();
  });
});
