import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { components } from '@ultm8/api-client';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { formatMoney } from '../lib/formatMoney';
import { useMyTransactions, useTransactionReceiptUrl } from './transactionQueries';

type Transaction = components['schemas']['TransactionResponseDto'];

const STATUS_COLOR: Record<string, string> = {
  SUCCESSFUL: '#188038',
  PENDING: '#9AA0A6',
  FAILED: '#C5221F',
  REFUNDED: '#9AA0A6',
  DISPUTED: '#C5221F',
};

/** One receipt — what it paid for (the membership plan title, joined server-side,
 * see TransactionResponseDto's own header comment), the amount+currency (formatMoney,
 * same helper MembershipPlanRow already uses — Transaction.amount is minor-unit,
 * same convention as MembershipPlan.price), the billing date, and the status.
 *
 * "View receipt" calls `GET /transactions/{id}/invoice` and hands the Student off
 * to Stripe's own hosted receipt page via `expo-web-browser` — the same
 * "hand off to the device browser for a Stripe-hosted page" pattern
 * `PaymentMethodsScreen.tsx` already established for Checkout, just
 * `openBrowserAsync` (plain view-and-close) instead of `openAuthSessionAsync`
 * (there's no return-redirect to catch here, unlike a Checkout flow). A `null`
 * `receiptUrl` (CASH/BANK_TRANSFER, or Stripe simply has no receipt yet) shows an
 * inline message instead of silently doing nothing — a real, normal state, not
 * treated as an error. */
function TransactionRow({ transaction }: { transaction: Transaction }) {
  const statusColor = STATUS_COLOR[transaction.status] ?? '#5F6368';
  const getReceiptUrl = useTransactionReceiptUrl();
  const [error, setError] = useState<string | null>(null);

  async function handleViewReceipt() {
    setError(null);
    try {
      const { receiptUrl } = await getReceiptUrl.mutateAsync(transaction.id);
      if (!receiptUrl) {
        setError('No receipt is available for this payment.');
        return;
      }
      await WebBrowser.openBrowserAsync(receiptUrl);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the receipt — please try again.'));
    }
  }

  return (
    <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 }}>{transaction.membershipPlanTitle}</Text>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>{formatMoney(transaction.amount, transaction.currency)}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ color: '#5F6368', fontSize: 12 }}>{formatDate(transaction.billingDate)}</Text>
        <Text style={{ color: statusColor, fontSize: 12, fontWeight: '600' }}>{transaction.status}</Text>
      </View>
      <Pressable onPress={handleViewReceipt} disabled={getReceiptUrl.isPending} style={{ marginTop: 8 }}>
        <Text style={{ color: '#1A73E8', fontSize: 13, fontWeight: '600' }}>
          {getReceiptUrl.isPending ? 'Loading…' : 'View receipt'}
        </Text>
      </Pressable>
      {error ? <Text style={{ color: '#C5221F', fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

export function TransactionHistoryScreen() {
  const query = useMyTransactions();

  return (
    <PaginatedListScreen
      query={query}
      renderItem={(item: Transaction) => <TransactionRow transaction={item} />}
      emptyMessage="No payment history yet."
      errorFallbackMessage="Failed to load your payment history — please try again."
    />
  );
}
