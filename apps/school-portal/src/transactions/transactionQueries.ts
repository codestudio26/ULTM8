import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type TransactionResponse = components['schemas']['TransactionResponseDto'];
export type TransactionSummary = components['schemas']['TransactionSummaryResponseDto'];

/** One page of the School's ledger, newest first — TransactionsController's
 * GET schools/:schoolId/transactions. `cursor` is the previous page's
 * `nextCursor`; the page keeps a stack of them for Prev/Next (Decision 335, T1),
 * the same pager ClassesPage uses. */
export function useTransactions(schoolId: string | null, cursor: string | null) {
  return useQuery({
    queryKey: ['transactions', schoolId, cursor],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/transactions', {
          params: { path: { schoolId: schoolId! }, query: cursor ? { cursor } : {} },
        }),
      ),
    enabled: !!schoolId,
  });
}

/** The page's tiles, counted over the whole ledger on the server (Decision 335,
 * T1) — not added up from whichever page of rows is on screen. */
export function useTransactionSummary(schoolId: string | null) {
  return useQuery({
    queryKey: ['transactions', schoolId, 'summary'],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/transactions/summary', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** GET /transactions/{id}/invoice — Spec 55 §7's own confirmed
 * `GET /transactions/{id}/invoice (download)` shape, closed with NO
 * PDF-generation infra: surfaces Stripe's own hosted receipt page for a
 * Transaction paid via Stripe (`StripeClientService.getReceiptUrl`'s own
 * header comment, apps/api). The page only offers it on card rows (Decision
 * 335, T7); `receiptUrl` can still be `null` when Stripe has no receipt yet.
 * Takes the Transaction id at `mutate()` time, same "fires from a row in a
 * table of many" shape every other per-row action in this app uses. */
export function useTransactionReceiptUrl() {
  return useMutation({
    mutationFn: (transactionId: string) =>
      unwrap(apiClient.GET('/v1/transactions/{id}/invoice', { params: { path: { id: transactionId } } })),
  });
}

/** "Mark as paid" (PATCH /transactions/{id}/confirm) and "Cancel"
 * (PATCH /transactions/{id}/cancel) for a Pending Cash/Bank Transfer payment —
 * Owner/Manager only (Decision 335, G1). Both refresh the ledger and its tiles. */
export function useSettleTransaction(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'confirm' | 'cancel' }) =>
      action === 'confirm'
        ? unwrap(apiClient.PATCH('/v1/transactions/{id}/confirm', { params: { path: { id } } }))
        : unwrap(apiClient.PATCH('/v1/transactions/{id}/cancel', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions', schoolId] }),
  });
}
