import React from 'react';
import { Badge } from '@ultm8/ui';
import { titleCase } from './text';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

export const PAYMENT_STATUS_LABELS: Record<string, TranslationKey> = {
  SUCCESSFUL: 'lib.paymentStatus.successful',
  PENDING: 'lib.paymentStatus.pending',
  FAILED: 'lib.paymentStatus.failed',
  REFUNDED: 'lib.paymentStatus.refunded',
  DISPUTED: 'lib.paymentStatus.disputed',
};

/** Rendered as its own small component so the label can be translated
 * (`useT()` needs a component), while `paymentStatusBadge()` keeps its
 * plain-function shape for every existing caller's table `render`. */
function PaymentStatusBadge({ status }: { status: string }) {
  const t = useT();
  const key = PAYMENT_STATUS_LABELS[status];
  const label = key ? t(key) : titleCase(status);
  if (status === 'SUCCESSFUL') return <Badge variant="success">{label}</Badge>;
  if (status === 'DISPUTED') return <Badge variant="danger">{label}</Badge>;
  if (status === 'FAILED') return <Badge variant="accent">{label}</Badge>;
  return <Badge>{label}</Badge>;
}

/** Shared by every screen showing a Transaction-shaped payment status
 * (SUCCESSFUL/PENDING/FAILED/REFUNDED/DISPUTED — TransactionResponseDto and
 * FranchiseFeeChargeResponseDto both use this exact enum) — extracted here
 * rather than duplicated per screen (originally TransactionsPage's own
 * `statusBadge`, moved here when FranchiseDetailPage needed the identical
 * logic for fee-charge status, Phase 23). */
export function paymentStatusBadge(status: string) {
  return <PaymentStatusBadge status={status} />;
}
