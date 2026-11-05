import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as membershipQueries from './membershipQueries';
import { MembershipRow } from './MyMembershipsScreen';
import * as memberApp from '../lib/memberAppQueries';

// Decision 318 item 7: the member app switches (on unless a test turns one off).
jest.mock('../lib/memberAppQueries', () => {
  const actual = jest.requireActual('../lib/memberAppQueries') as object;
  return { ...actual, useMemberAppSettings: jest.fn(() => ({ data: undefined })) };
});

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

  const ENDS_AFTER_TERM = { minimumTermEndsAt: '2030-03-15T12:00:00Z', earlyExitFee: 0, currency: 'GBP', endsAfterMinimumTerm: true };

  it('Decision 435 item 16: a contract that ends after its minimum term says so', async () => {
    const { getByText } = await render(<MembershipRow membership={{ ...SUBSCRIPTION, contract: ENDS_AFTER_TERM } as never} />);
    expect(getByText(/^Ends after its minimum term, on .*\. It doesn't renew\.$/)).toBeTruthy();
  });

  it('Decision 435 item 16: once set to stop on that day, it still reads as ending after the term, not cancelled', async () => {
    const { getByText, queryByText } = await render(
      <MembershipRow membership={{ ...SUBSCRIPTION, contract: ENDS_AFTER_TERM, cancelAt: '2030-03-15T12:00:00Z' } as never} />,
    );
    expect(getByText(/^Ends after its minimum term/)).toBeTruthy();
    expect(queryByText(/Cancelled, ends/)).toBeNull();
  });

  it('Decision 435 item 16: cancelled to an earlier day, it reads as cancelled', async () => {
    const { getByText } = await render(<MembershipRow membership={{ ...SUBSCRIPTION, contract: ENDS_AFTER_TERM, cancelAt: '2029-11-01T12:00:00Z' } as never} />);
    expect(getByText(/Cancelled, ends/)).toBeTruthy();
  });

  it('offers nothing for a one-time plan', async () => {
    const { queryByText } = await render(<MembershipRow membership={{ ...SUBSCRIPTION, frequency: 'ONE_TIME' } as never} />);
    expect(queryByText('Cancel subscription')).toBeNull();
  });
});

/** Decision 427 — Student portal review SP5: the plan's and School's names, never "Plan <id>". */
describe('MembershipRow — names', () => {
  beforeEach(() => {
    mocked(membershipQueries.useCancelSubscription).mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
  });

  it('shows the plan and School names the API sends', async () => {
    const row = { ...SUBSCRIPTION, frequency: 'ONE_TIME', planTitle: '10-Class Pack', schoolName: 'Alpha Dojo' };
    const { getByText, queryByText } = await render(<MembershipRow membership={row as never} />);
    expect(getByText('10-Class Pack')).toBeTruthy();
    expect(getByText('Alpha Dojo')).toBeTruthy();
    expect(queryByText(/plan-1/)).toBeNull();
  });

  it('falls back to a plain word, not the plan id, when the name is unknown', async () => {
    const row = { ...SUBSCRIPTION, frequency: 'ONE_TIME', membershipPlanId: 'unknown-plan', planTitle: null, schoolName: null };
    const { getByText, queryByText } = await render(<MembershipRow membership={row as never} />);
    expect(getByText('Membership')).toBeTruthy();
    expect(queryByText(/unknown-plan/)).toBeNull();
  });
});

/** Decision 318 item 7: a School may cancel memberships itself. */
describe('MembershipRow — the School cancels memberships itself', () => {
  beforeEach(() => {
    mocked(membershipQueries.useCancelSubscription).mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
  });

  it('offers no Cancel button and says to ask the School when the switch is off', async () => {
    mocked(memberApp.useMemberAppSettings).mockReturnValue({ data: { profileLocked: false, schools: [{ ...{ schoolId: 'school-1', editProfile: true, cancelMembership: true, addFamily: true, paymentHistory: true, gradingCountdown: false }, cancelMembership: false }] } });
    const { getByText, queryByText } = await render(<MembershipRow membership={SUBSCRIPTION as never} />);
    expect(queryByText('Cancel subscription')).toBeNull();
    expect(getByText('To cancel, ask the School.')).toBeTruthy();
  });

  it('keeps the Cancel button at a School that leaves it on', async () => {
    mocked(memberApp.useMemberAppSettings).mockReturnValue({ data: { profileLocked: false, schools: [{ ...{ schoolId: 'school-1', editProfile: true, cancelMembership: true, addFamily: true, paymentHistory: true, gradingCountdown: false }, schoolId: 'other', cancelMembership: false }, { schoolId: 'school-1', editProfile: true, cancelMembership: true, addFamily: true, paymentHistory: true, gradingCountdown: false }] } });
    const { getByText, queryByText } = await render(<MembershipRow membership={SUBSCRIPTION as never} />);
    expect(getByText('Cancel subscription')).toBeTruthy();
    expect(queryByText('To cancel, ask the School.')).toBeNull();
  });
});
