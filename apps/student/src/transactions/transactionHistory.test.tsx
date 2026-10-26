import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ApiError } from '@ultm8/api-client';
import * as WebBrowser from 'expo-web-browser';
import * as transactionQueries from './transactionQueries';
import { TransactionHistoryScreen } from './TransactionHistoryScreen';

jest.mock('./transactionQueries', () => ({
  useMyTransactions: jest.fn(),
  useTransactionReceiptUrl: jest.fn(),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const idleMutation = () => ({ mutateAsync: jest.fn<() => Promise<{ receiptUrl: string | null }>>(), isPending: false });

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
  beforeEach(() => {
    jest.clearAllMocks();
    mocked(transactionQueries.useTransactionReceiptUrl).mockReturnValue(idleMutation());
  });

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

  it('labels a renewal and a late-cancellation fee (Decision 346)', async () => {
    const base = {
      schoolId: 's1',
      studentId: 'me',
      paymentAccountId: 'pa1',
      membershipId: null,
      billingDate: '2026-10-01T12:00:00.000Z',
      currency: 'gbp',
      status: 'SUCCESSFUL',
      paymentMethod: 'STRIPE',
      disputedAmount: null,
      refundedAmount: null,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
    };
    mocked(transactionQueries.useMyTransactions).mockReturnValue(
      pagedQuery([
        { ...base, id: 'tx1', kind: 'RENEWAL', membershipPlanId: 'mp1', membershipPlanTitle: 'Monthly', amount: 4000 },
        { ...base, id: 'tx2', kind: 'LATE_CANCEL_FEE', membershipPlanId: null, membershipPlanTitle: null, bookingClassTitle: 'Kids BJJ', amount: 500 },
        { ...base, id: 'tx3', kind: 'LATE_CANCEL_FEE', membershipPlanId: null, membershipPlanTitle: null, bookingClassTitle: null, amount: 500 },
      ]),
    );

    const { getByText } = await render(<TransactionHistoryScreen />);
    expect(getByText('Renewal: Monthly')).toBeTruthy();
    expect(getByText('Late-cancellation fee: Kids BJJ')).toBeTruthy();
    expect(getByText('Late-cancellation fee')).toBeTruthy();
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

  describe('View receipt', () => {
    const TX = {
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
      paymentMethod: 'STRIPE',
      disputedAmount: null,
      refundedAmount: null,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
    };

    it('opens the receipt URL in the device browser when one is returned', async () => {
      const mutateAsync = jest.fn<() => Promise<{ receiptUrl: string | null }>>().mockResolvedValue({ receiptUrl: 'https://pay.stripe.com/receipts/abc' });
      mocked(transactionQueries.useTransactionReceiptUrl).mockReturnValue({ mutateAsync, isPending: false });
      mocked(transactionQueries.useMyTransactions).mockReturnValue(pagedQuery([TX]));

      const { getByText } = await render(<TransactionHistoryScreen />);
      await fireEvent.press(getByText('View receipt'));

      expect(mutateAsync).toHaveBeenCalledWith('tx1');
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://pay.stripe.com/receipts/abc');
    });

    it('shows "No receipt is available" instead of opening a browser when receiptUrl is null (CASH/BANK_TRANSFER)', async () => {
      const mutateAsync = jest.fn<() => Promise<{ receiptUrl: string | null }>>().mockResolvedValue({ receiptUrl: null });
      mocked(transactionQueries.useTransactionReceiptUrl).mockReturnValue({ mutateAsync, isPending: false });
      mocked(transactionQueries.useMyTransactions).mockReturnValue(pagedQuery([{ ...TX, paymentMethod: 'BANK_TRANSFER' }]));

      const { getByText } = await render(<TransactionHistoryScreen />);
      await fireEvent.press(getByText('View receipt'));

      expect(getByText('No receipt is available for this payment.')).toBeTruthy();
      expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    });
  });
});
