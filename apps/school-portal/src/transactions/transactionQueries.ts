import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { ALL_PAGES_LIMIT, fetchAllPages } from '../lib/fetchAllPages';

export type TransactionResponse = components['schemas']['TransactionResponseDto'];
export type TransactionSummary = components['schemas']['TransactionSummaryResponseDto'];
export type RecordDeskPaymentInput = components['schemas']['RecordDeskPaymentDto'];

/** The page's filters (Decision 346, G3). Empty strings mean "any". */
export interface TransactionFilters {
  status: '' | 'SUCCESSFUL' | 'PENDING' | 'FAILED' | 'REFUNDED' | 'DISPUTED';
  paymentMethod: '' | 'STRIPE' | 'CASH' | 'BANK_TRANSFER' | 'PIX' | 'CARD_TERMINAL';
  kind: '' | 'MEMBERSHIP' | 'RENEWAL' | 'LATE_CANCEL_FEE';
  membershipPlanId: string;
  from: string;
  to: string;
}

export const NO_FILTERS: TransactionFilters = { status: '', paymentMethod: '', kind: '', membershipPlanId: '', from: '', to: '' };

/** The filters as query params, leaving out the ones set to "any". */
export function filterQuery(f: TransactionFilters) {
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.paymentMethod ? { paymentMethod: f.paymentMethod } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.membershipPlanId ? { membershipPlanId: f.membershipPlanId } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
  };
}

/** One page of the School's ledger, newest first — TransactionsController's
 * GET schools/:schoolId/transactions. `cursor` is the previous page's
 * `nextCursor`; the page keeps a stack of them for Prev/Next (Decision 339, T1),
 * the same pager ClassesPage uses. */
export function useTransactions(schoolId: string | null, cursor: string | null, filters: TransactionFilters = NO_FILTERS) {
  return useQuery({
    queryKey: ['transactions', schoolId, 'list', filters, cursor],
    queryFn: () => fetchTransactionsPage(schoolId!, filters, cursor ?? undefined),
    enabled: !!schoolId,
  });
}

/** One page of the ledger with these filters; also what the CSV export pages through. */
export function fetchTransactionsPage(schoolId: string, filters: TransactionFilters, cursor?: string, limit?: number) {
  return unwrap(
    apiClient.GET('/v1/schools/{schoolId}/transactions', {
      params: { path: { schoolId }, query: { ...filterQuery(filters), ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) } },
    }),
  );
}

/** The page's tiles, counted over the whole ledger on the server (Decision 339,
 * T1) — not added up from whichever page of rows is on screen. */
export function useTransactionSummary(schoolId: string | null, filters: TransactionFilters = NO_FILTERS) {
  return useQuery({
    queryKey: ['transactions', schoolId, 'summary', filters],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/transactions/summary', { params: { path: { schoolId: schoolId! }, query: filterQuery(filters) } })),
    enabled: !!schoolId,
  });
}

/** GET /transactions/{id}/invoice — Spec 55 §7's own confirmed
 * `GET /transactions/{id}/invoice (download)` shape, closed with NO
 * PDF-generation infra: surfaces Stripe's own hosted receipt page for a
 * Transaction paid via Stripe (`StripeClientService.getReceiptUrl`'s own
 * header comment, apps/api). The page only offers it on card rows (Decision
 * 339, T7); `receiptUrl` can still be `null` when Stripe has no receipt yet.
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
 * Owner/Manager only (Decision 339, G1). Both refresh the ledger and its tiles. */
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

/** "Record a payment" (POST /schools/{schoolId}/desk-payments, Decision 346, G7):
 * cash or a bank transfer taken in person. Starts the membership at once. */
export function useRecordDeskPayment(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordDeskPaymentInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/desk-payments', { params: { path: { schoolId: schoolId! } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions', schoolId] }),
  });
}

/** Who and what Record a payment can be used for (Decision 347): every
 * current Student for the owner, the students of their own branches for Branch
 * Staff; plans paid once (no Subscriptions, Friend Passes or archived plans). */
export function useDeskPaymentOptions(schoolId: string | null) {
  return useQuery({
    queryKey: ['deskPaymentOptions', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/desk-payments/options', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** Every Membership Plan of the School, not just the first page, for the plan
 * filter and the Record a payment picker (a 21st plan must still be pickable). */
export function useAllMembershipPlans(schoolId: string | null) {
  return useQuery({
    queryKey: ['membershipPlans', schoolId, 'all'],
    queryFn: () =>
      fetchAllPages((cursor) =>
        unwrap(
          apiClient.GET('/v1/schools/{schoolId}/membership-plans', {
            params: { path: { schoolId: schoolId! }, query: { cursor, limit: ALL_PAGES_LIMIT } },
          }),
        ),
      ),
    enabled: !!schoolId,
  });
}
