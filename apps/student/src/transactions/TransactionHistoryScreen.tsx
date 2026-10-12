import React from 'react';
import { Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { formatDate } from '../lib/formatDate';
import { formatMoney } from '../lib/formatMoney';
import { useMyTransactions } from './transactionQueries';

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
 * same convention as MembershipPlan.price), the billing date, and the status. Nothing
 * else to show or do here: no PDF/invoice download exists anywhere in this codebase
 * (see transactionQueries.ts's own header comment), so this is read-only. */
function TransactionRow({ transaction }: { transaction: Transaction }) {
  const statusColor = STATUS_COLOR[transaction.status] ?? '#5F6368';
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
