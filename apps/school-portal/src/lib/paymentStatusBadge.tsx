import React from 'react';
import { Badge } from '@ultm8/ui';
import { titleCase } from './text';

/** Shared by every screen showing a Transaction-shaped payment status
 * (SUCCESSFUL/PENDING/FAILED/REFUNDED/DISPUTED — TransactionResponseDto and
 * FranchiseFeeChargeResponseDto both use this exact enum) — extracted here
 * rather than duplicated per screen (originally TransactionsPage's own
 * `statusBadge`, moved here when FranchiseDetailPage needed the identical
 * logic for fee-charge status, Phase 23). */
export function paymentStatusBadge(status: string) {
  if (status === 'SUCCESSFUL') return <Badge variant="success">Successful</Badge>;
  if (status === 'DISPUTED') return <Badge variant="danger">Disputed</Badge>;
  if (status === 'FAILED') return <Badge variant="accent">Failed</Badge>;
  return <Badge>{titleCase(status)}</Badge>;
}
