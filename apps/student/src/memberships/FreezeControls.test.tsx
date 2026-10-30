import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as freezeQueries from './freezeQueries';
import { FreezeControls } from './FreezeControls';

jest.mock('./freezeQueries', () => ({
  useRequestFreeze: jest.fn(),
  useFreezeAction: jest.fn(),
  addDays: (day: string, n: number) => {
    const d = new Date(`${day}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },
}));

jest.setTimeout(30_000);

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const ITEM = {
  membershipId: 'm-1', studentId: 's-1', studentFirstName: 'Ana', self: true, schoolId: 'school-1', schoolName: 'Dojo', planTitle: 'Monthly',
  planType: 'SUBSCRIPTION', expiryDate: null, frozen: false, freeze: null, maxDaysPer12Months: 90, feeAmount: 1500, currency: 'GBP', today: '2026-11-02',
};

/** Decision 404 — the member asks for a freeze, withdraws it, or ends it early. */
describe('FreezeControls', () => {
  let request: { mutateAsync: jest.Mock; isPending: boolean };
  let action: { mutateAsync: jest.Mock; isPending: boolean };

  beforeEach(() => {
    jest.clearAllMocks();
    request = { mutateAsync: jest.fn(async () => ({})), isPending: false };
    action = { mutateAsync: jest.fn(async () => ({})), isPending: false };
    mocked(freezeQueries.useRequestFreeze).mockReturnValue(request);
    mocked(freezeQueries.useFreezeAction).mockReturnValue(action);
  });

  it('asks for a freeze with the dates typed, showing the limit and the fee', async () => {
    const { getByText, getByDisplayValue } = await render(<FreezeControls item={ITEM as never} />);
    await fireEvent.press(getByText('Request a freeze'));
    expect(getByText(/Most frozen days in any 12 months: 90/)).toBeTruthy();
    expect(getByText(/Freeze fee, charged if approved/)).toBeTruthy();
    await fireEvent.changeText(getByDisplayValue('2026-12-02'), '2026-11-20');
    await fireEvent.press(getByText('Send request'));
    await waitFor(() => expect(request.mutateAsync).toHaveBeenCalledWith({ membershipId: 'm-1', startsAt: '2026-11-02', endsAt: '2026-11-20' }));
  });

  it('withdraws a request waiting for the School', async () => {
    const item = { ...ITEM, freeze: { id: 'f-1', status: 'REQUESTED', startsAt: '2026-11-10', endsAt: '2026-11-20' } };
    const { getByText, queryByText } = await render(<FreezeControls item={item as never} />);
    expect(getByText(/Freeze requested/)).toBeTruthy();
    expect(queryByText('Request a freeze')).toBeNull();
    await fireEvent.press(getByText('Withdraw request'));
    await waitFor(() => expect(action.mutateAsync).toHaveBeenCalledWith({ freezeId: 'f-1', action: 'cancel' }));
  });

  it('ends a running freeze early, after asking', async () => {
    const item = { ...ITEM, frozen: true, freeze: { id: 'f-2', status: 'APPROVED', startsAt: '2026-11-01', endsAt: '2026-11-20' } };
    const { getByText } = await render(<FreezeControls item={item as never} />);
    expect(getByText(/Frozen until/)).toBeTruthy();
    await fireEvent.press(getByText('End freeze early'));
    expect(action.mutateAsync).not.toHaveBeenCalled();
    await fireEvent.press(getByText('End freeze'));
    await waitFor(() => expect(action.mutateAsync).toHaveBeenCalledWith({ freezeId: 'f-2', action: 'end' }));
  });
});
