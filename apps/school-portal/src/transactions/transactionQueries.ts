import { useMutation, useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type TransactionResponse = components['schemas']['TransactionResponseDto'];

/** Read-only list — TransactionsController's GET schools/:schoolId/transactions
 * (Phase 9's own scoping: "no refund, no credit-restore" this phase — invoice
 * download is now built, see `useTransactionReceiptUrl` below). No pagination
 * in this UI yet — same established convention as the other list screens. */
export function useTransactions(schoolId: string | null) {
  return useQuery({
    queryKey: ['transactions', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/transactions', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** GET /transactions/{id}/invoice — Spec 55 §7's own confirmed
 * `GET /transactions/{id}/invoice (download)` shape, closed with NO
 * PDF-generation infra: surfaces Stripe's own hosted receipt page for a
 * Transaction paid via Stripe (`StripeClientService.getReceiptUrl`'s own
 * header comment, apps/api). `receiptUrl` is `null` — a real, normal state,
 * not an error — for a Transaction paid by CASH/BANK_TRANSFER, or one Stripe
 * has no receipt for yet. Authorization is the same School-Owner gate the
 * bulk ledger read (`useTransactions` above) already requires — this is just
 * a drill-down from the same table a Staff member is already authorized to
 * see. Takes the Transaction id at `mutate()` time, same "fires from a row in
 * a table of many" shape every other per-row action in this app uses (e.g.
 * `useArchiveBranch`/`useArchiveClass` in branchQueries.ts/classQueries.ts). */
export function useTransactionReceiptUrl() {
  return useMutation({
    mutationFn: (transactionId: string) =>
      unwrap(apiClient.GET('/v1/transactions/{id}/invoice', { params: { path: { id: transactionId } } })),
  });
}
