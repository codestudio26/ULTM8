import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { components } from '@ultm8/api-client';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { formatMoney } from '../lib/formatMoney';
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';
import { useMyTransactions, useTransactionReceiptUrl } from './transactionQueries';

type Transaction = components['schemas']['TransactionResponseDto'];

const STATUS_COLOR: Record<string, string> = {
  SUCCESSFUL: '#188038',
  PENDING: '#9AA0A6',
  FAILED: '#C5221F',
  REFUNDED: '#9AA0A6',
  DISPUTED: '#C5221F',
};

const STATUS_LABEL: Record<string, TranslationKey> = {
  SUCCESSFUL: 'transactions.status.successful',
  PENDING: 'transactions.status.pending',
  FAILED: 'transactions.status.failed',
  REFUNDED: 'transactions.status.refunded',
  DISPUTED: 'transactions.status.disputed',
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
/** What the payment was for: the plan, a later renewal of it, or a
 * late-cancellation fee naming its class (Decision 346). */
function rowTitle(transaction: Transaction, t: ReturnType<typeof useT>): string {
  if (transaction.kind === 'LATE_CANCEL_FEE') {
    return transaction.bookingClassTitle
      ? t('transactions.row.lateCancelFee', { class: transaction.bookingClassTitle })
      : t('transactions.row.lateCancelFeeNoClass');
  }
  const plan = transaction.membershipPlanTitle ?? '';
  // Decision 404: the School's fee for freezing a membership.
  if (transaction.kind === 'FREEZE_FEE') return plan ? t('transactions.row.freezeFee', { plan }) : t('transactions.row.freezeFeeNoPlan');
  // Decision 338 item 9: a payment taken at the desk toward a charge.
  if (transaction.kind === 'CHARGE_PAYMENT') {
    return transaction.chargeInvoiceLabel
      ? t('charges.transactions.item', { invoice: transaction.chargeInvoiceLabel, description: transaction.chargeDescription ?? '' })
      : t('charges.transactions.itemBalance');
  }
  return transaction.kind === 'RENEWAL' ? t('transactions.row.renewal', { plan }) : plan;
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const t = useT();
  const statusColor = STATUS_COLOR[transaction.status] ?? '#5F6368';
  const statusLabel = STATUS_LABEL[transaction.status];
  const getReceiptUrl = useTransactionReceiptUrl();
  const [error, setError] = useState<string | null>(null);

  async function handleViewReceipt() {
    setError(null);
    try {
      const { receiptUrl } = await getReceiptUrl.mutateAsync(transaction.id);
      if (!receiptUrl) {
        setError(t('transactions.row.noReceipt'));
        return;
      }
      await WebBrowser.openBrowserAsync(receiptUrl);
    } catch (err) {
      setError(getApiErrorMessage(err, t('transactions.row.receiptFailed')));
    }
  }

  return (
    <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 }}>{rowTitle(transaction, t)}</Text>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>{formatMoney(transaction.amount + (transaction.surchargeAmount ?? 0), transaction.currency)}</Text>
      </View>
      {/* Decision 406: a card surcharge is its own line on the receipt. */}
      {(transaction.surchargeAmount ?? 0) > 0 ? (
        <Text style={{ color: '#5F6368', fontSize: 12, marginTop: 2 }}>
          {t('transactions.row.surchargeLine', {
            price: formatMoney(transaction.amount, transaction.currency),
            surcharge: formatMoney(transaction.surchargeAmount, transaction.currency),
          })}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ color: '#5F6368', fontSize: 12 }}>{formatDate(transaction.billingDate)}</Text>
        <Text style={{ color: statusColor, fontSize: 12, fontWeight: '600' }}>{statusLabel ? t(statusLabel) : transaction.status}</Text>
      </View>
      <Pressable onPress={handleViewReceipt} disabled={getReceiptUrl.isPending} style={{ marginTop: 8 }}>
        <Text style={{ color: '#1A73E8', fontSize: 13, fontWeight: '600' }}>
          {getReceiptUrl.isPending ? t('transactions.row.loading') : t('transactions.row.viewReceipt')}
        </Text>
      </Pressable>
      {error ? <Text style={{ color: '#C5221F', fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

export function TransactionHistoryScreen() {
  const t = useT();
  const query = useMyTransactions();

  return (
    <PaginatedListScreen
      query={query}
      renderItem={(item: Transaction) => <TransactionRow transaction={item} />}
      emptyMessage={t('transactions.list.empty')}
      errorFallbackMessage={t('transactions.list.loadFailed')}
    />
  );
}
