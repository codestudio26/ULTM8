import React from 'react';
import { formatMoney } from '../lib/money';
import { useT } from '../i18n/I18nProvider';
import { useJoiningFeePreview } from './membershipPlanQueries';

/**
 * Decision 435 items 2-3: at the desk, a member's first-ever plan at the
 * School carries the plan's joining fee in the money taken now. Says so, and
 * the total to collect, when the API's preview has a fee for this member and
 * plan; nothing otherwise.
 */
export function JoiningFeeNotice({ planId, studentId, price, currency }: { planId: string | null; studentId: string | null; price: number; currency: string | null }) {
  const t = useT();
  const fee = useJoiningFeePreview(planId, studentId).data?.joiningFee ?? 0;
  if (fee <= 0) return null;
  return (
    <p style={{ margin: '0 0 12px' }} data-testid="joining-fee-notice">
      {t('membershipPlans.form.joiningFeeDeskNotice', { fee: formatMoney(fee, currency), total: formatMoney(price + fee, currency) })}
    </p>
  );
}

/** The amount to collect at the desk: the plan's price plus any joining fee. */
export function useDeskTotal(planId: string | null, studentId: string | null, price: number): number {
  return price + (useJoiningFeePreview(planId, studentId).data?.joiningFee ?? 0);
}
