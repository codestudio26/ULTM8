import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { ApiError } from '@ultm8/api-client';
import * as transactionQueries from './transactionQueries';
import { TransactionHistoryScreen } from './TransactionHistoryScreen';

jest.mock('./transactionQueries', () => ({
  useMyTransactions: jest.fn(),
}));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

interface FakePage {
  data: { pages: { items: unknown[] }[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  fetchNextPage: jest.Mock;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}

function pagedQuery(items: unknown[], overrides: Partial<FakePage> = {}): FakePage {
  return {
    data: { pages: [{ items }] },
    isLoading: false,
    isError: false,
    error: null,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

/** Same house style as MyBookingsScreen.test.tsx/QrCheckInScreen.test.tsx: mock the
 * query module entirely, inline fixtures, render + RTL getByText, no real
 * react-query/network runtime. */
describe('TransactionHistoryScreen', () => {
  it('shows a spinner while loading', async () => {
    mocked(transactionQueries.useMyTransactions).mockReturnValue(pagedQuery([], { isLoading: true, data: undefined }));

    const { toJSON } = await render(<TransactionHistoryScreen />);
    expect(JSON.stringify(toJSON())).toContain('ActivityIndicator');
  });

  it('shows an empty message when there is no payment history', async () => {
    mocked(transactionQueries.useMyTransactions).mockReturnValue(pagedQuery([]));

    const { getByText } = await render(<TransactionHistoryScreen />);
    expect(getByText('No payment history yet.')).toBeTruthy();
  });

  it('renders each transaction row with what it paid for, amount+currency, date, and status', async () => {
    mocked(transactionQueries.useMyTransactions).mockReturnValue(
      pagedQuery([
        {
          id: 'tx1',
          schoolId: 's1',
          studentId: 'me',
          paymentAccountId: 'pa1',
          membershipPlanId: 'mp1',
          membershipPlanTitle: '5-Class Pack',
          membershipId: 'm1',
          billingDate: '2026-10-01T12:00:00.000Z',
          amount: 5000,
          currency: 'gbp',
          status: 'SUCCESSFUL',
          paymentMethod: 'BANK_TRANSFER',
          disputedAmount: null,
          refundedAmount: null,
          createdAt: '2026-10-01T12:00:00.000Z',
          updatedAt: '2026-10-01T12:00:00.000Z',
        },
      ]),
    );

    const { getByText } = await render(<TransactionHistoryScreen />);
    expect(getByText('5-Class Pack')).toBeTruthy();
    expect(getByText('£50.00')).toBeTruthy();
    expect(getByText('SUCCESSFUL')).toBeTruthy();
  });

  it('shows the real error message when there is no cached page to fall back on', async () => {
    mocked(transactionQueries.useMyTransactions).mockReturnValue(
      pagedQuery([], { isError: true, error: new ApiError(500, 'INTERNAL', 'boom'), data: undefined }),
    );

    const { getByText } = await render(<TransactionHistoryScreen />);
    expect(getByText('boom')).toBeTruthy();
  });

  it('keeps showing already-loaded transactions through a background refetch failure', async () => {
    mocked(transactionQueries.useMyTransactions).mockReturnValue(
      pagedQuery(
        [
          {
            id: 'tx1',
            schoolId: 's1',
            studentId: 'me',
            paymentAccountId: 'pa1',
            membershipPlanId: 'mp1',
            membershipPlanTitle: 'Unlimited Monthly',
            membershipId: 'm1',
            billingDate: '2026-09-01T12:00:00.000Z',
            amount: 3000,
            currency: 'gbp',
            status: 'SUCCESSFUL',
            paymentMethod: 'STRIPE',
            disputedAmount: null,
            refundedAmount: null,
            createdAt: '2026-09-01T12:00:00.000Z',
            updatedAt: '2026-09-01T12:00:00.000Z',
          },
        ],
        { isError: true, error: new ApiError(500, 'INTERNAL', 'boom') },
      ),
    );

    const { getByText, queryByText } = await render(<TransactionHistoryScreen />);
    expect(getByText('Unlimited Monthly')).toBeTruthy();
    expect(queryByText('boom')).toBeNull();
  });
});
