import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { MoneyField } from '../lib/MoneyField';
import { useT } from '../i18n/I18nProvider';
import { useSetPlanContract, type MembershipPlanResponse } from './membershipPlanQueries';
import { Chapter } from '../students/StudentFormParts';

/**
 * Decision 316 item 6: the School's own contract on a plan. Members sign it
 * in the app when they buy the plan, like a waiver; members who already
 * signed keep the version they signed. A minimum term and an early-exit fee
 * are for Subscriptions only. Saved on its own (PUT .../contract), so the
 * plan form above is unchanged.
 */
export function PlanContractCard({ plan, currency }: { plan: MembershipPlanResponse; currency?: string | null }) {
  const t = useT();
  const save = useSetPlanContract(plan.schoolId, plan.id);
  const isSubscription = plan.type === 'SUBSCRIPTION';
  const [body, setBody] = useState(plan.contractBody ?? '');
  const [term, setTerm] = useState(plan.contractMinimumTermMonths != null ? String(plan.contractMinimumTermMonths) : '');
  const [fee, setFee] = useState<number | null>(plan.contractEarlyExitFee ?? null);
  const [endsAfterTerm, setEndsAfterTerm] = useState(plan.contractEndsAfterMinimumTerm ?? false);
  const [feeValid, setFeeValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (plan.type === 'FRIEND_PASS') return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const months = term.trim() ? Number(term) : null;
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) return setError(t('membershipPlans.contract.invalidTerm'));
    if (!feeValid) return setError(t('membershipPlans.contract.invalidFee'));
    const hasText = body.trim().length > 0;
    try {
      await save.mutateAsync({
        body: hasText ? body : null,
        minimumTermMonths: hasText && isSubscription ? months : null,
        earlyExitFee: hasText && isSubscription && months !== null ? fee : null,
        // Decision 435 item 16.
        endsAfterMinimumTerm: hasText && isSubscription && months !== null ? endsAfterTerm : false,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('membershipPlans.contract.failed'));
    }
  }

  // A sheet of its own under the plan form (form pattern "F"), saved on its own.
  return (
    <form className="u8f-sheet u8p-contract" onSubmit={handleSave} aria-label={t('membershipPlans.contract.title')}>
      <Chapter title={t('membershipPlans.contract.title')} description={t('membershipPlans.contract.subtitle')}>
        <p className="ultm8-field__hint u8f-wide u8p-note">
          {plan.contractVersion != null ? t('membershipPlans.contract.version', { version: plan.contractVersion }) : t('membershipPlans.contract.none')}
        </p>
        {error ? (
          <div className="u8f-wide">
            <ErrorBanner message={error} />
          </div>
        ) : null}
        <div className="u8f-wide">
          <Field label={t('membershipPlans.contract.bodyLabel')} htmlFor="plan-contract-body" hint={t('membershipPlans.contract.bodyHint')}>
            <TextArea id="plan-contract-body" rows={10} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </div>
        {isSubscription ? (
          <>
            <Field label={t('membershipPlans.contract.minimumTermLabel')} htmlFor="plan-contract-term" hint={t('membershipPlans.contract.minimumTermHint')}>
              <TextField id="plan-contract-term" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} />
            </Field>
            <Field label={t('membershipPlans.contract.earlyExitFeeLabel')} htmlFor="plan-contract-fee" hint={t('membershipPlans.contract.earlyExitFeeHint')}>
              <MoneyField
                id="plan-contract-fee"
                value={fee}
                currency={plan.currency ?? currency}
                disabled={!term.trim()}
                onChange={(minor, valid) => {
                  setFee(minor);
                  setFeeValid(valid);
                }}
              />
            </Field>
            {/* Decision 435 item 16: stops at the end of the minimum term instead of renewing. */}
            <div className="u8f-wide">
              <Checkbox
                id="plan-contract-ends-after-term"
                label={t('membershipPlans.contract.endsAfterTermLabel')}
                checked={endsAfterTerm && !!term.trim()}
                disabled={!term.trim()}
                onChange={(e) => setEndsAfterTerm(e.target.checked)}
              />
              <p className="ultm8-field__hint u8p-check-hint">{t('membershipPlans.contract.endsAfterTermHint')}</p>
            </div>
          </>
        ) : (
          <p className="ultm8-field__hint u8f-wide u8p-note">{t('membershipPlans.contract.subscriptionOnly')}</p>
        )}
        <p className="ultm8-field__hint u8f-wide u8p-note">{t('membershipPlans.contract.deskNote')}</p>
        {saved ? (
          <p role="status" className="u8f-wide u8p-note">
            {t('membershipPlans.contract.saved')}
          </p>
        ) : null}
      </Chapter>
      <div className="u8f-actions">
        <Button type="submit" loading={save.isPending}>
          {plan.contractVersion != null ? t('membershipPlans.contract.update') : t('membershipPlans.contract.add')}
        </Button>
      </div>
    </form>
  );
}
