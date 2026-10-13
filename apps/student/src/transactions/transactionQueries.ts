import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { usePaginatedQuery } from '../lib/usePaginatedQuery';

/** GET /transactions/me — a Student's own payment history/receipts (closes the
 * TRACK-B-ROADMAP.md "Explicitly blocked" gap of the same name). Cursor-paginated,
 * same convention as My Bookings/My Memberships (Decision 22/70) — see
 * usePaginatedQuery's own header comment. The one action available per row is
 * `useTransactionReceiptUrl` below — see its own header comment. */
export function useMyTransactions() {
  return usePaginatedQuery(['my-transactions'], (cursor) =>
    unwrap(apiClient.GET('/v1/transactions/me', { params: { query: { cursor } } })),
  );
}

/** GET /transactions/{id}/invoice — Spec 55 §7's own confirmed
 * `GET /transactions/{id}/invoice (download)` shape, closed with NO PDF-
 * generation infra: this surfaces Stripe's own hosted receipt page for a
 * Transaction paid via Stripe (`StripeClientService.getReceiptUrl`'s own
 * header comment). `receiptUrl` is `null` — a real, normal state, not an
 * error — for a Transaction paid by CASH/BANK_TRANSFER, or one Stripe simply
 * has no receipt for yet.
 *
 * Takes the Transaction id at `mutate()` time, not hook-creation time — same
 * "fires from a row in a list of many" shape `useCancelBooking`/`useBookClass`
 * (bookingQueries.ts) already established, since `TransactionRow` calls this
 * once per row, not once per screen. */
export function useTransactionReceiptUrl() {
  return useMutation({
    mutationFn: (transactionId: string) =>
      unwrap(apiClient.GET('/v1/transactions/{id}/invoice', { params: { path: { id: transactionId } } })),
  });
}
