import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { usePaginatedQuery } from '../lib/usePaginatedQuery';

/** GET /transactions/me — a Student's own payment history/receipts (closes the
 * TRACK-B-ROADMAP.md "Explicitly blocked" gap of the same name). Cursor-paginated,
 * same convention as My Bookings/My Memberships (Decision 22/70) — see
 * usePaginatedQuery's own header comment. Read-only: Transaction has no client
 * action to offer here (no PDF/invoice download infra exists anywhere in this
 * codebase; see apps/api's own TransactionsService header comment for why "receipt
 * viewing" means this list/detail, not a generated document). */
export function useMyTransactions() {
  return usePaginatedQuery(['my-transactions'], (cursor) =>
    unwrap(apiClient.GET('/v1/transactions/me', { params: { query: { cursor } } })),
  );
}
