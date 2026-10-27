/** English text: transactions (Decision 323) — the payment history screen. */
export const transactions = {
  list: {
    empty: 'No payment history yet.',
    loadFailed: 'Failed to load your payment history — please try again.',
  },
  row: {
    loading: 'Loading…',
    viewReceipt: 'View receipt',
    noReceipt: 'No receipt is available for this payment.',
    receiptFailed: 'Could not load the receipt — please try again.',
    renewal: 'Renewal: {plan}',
    lateCancelFee: 'Late-cancellation fee: {class}',
    lateCancelFeeNoClass: 'Late-cancellation fee',
  },
  /** A payment's status, shown in capitals on each row. */
  status: {
    successful: 'SUCCESSFUL',
    pending: 'PENDING',
    failed: 'FAILED',
    refunded: 'REFUNDED',
    disputed: 'DISPUTED',
  },
};
