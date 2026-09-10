import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type TransactionResponse = components['schemas']['TransactionResponseDto'];

/** Read-only — TransactionsController exposes only GET
 * schools/:schoolId/transactions (Phase 9's own scoping: "no refund, no
 * credit-restore, no invoice download" this phase). No pagination in this UI
 * yet — same established convention as the other list screens. */
export function useTransactions(schoolId: string | null) {
  return useQuery({
    queryKey: ['transactions', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/transactions', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}
