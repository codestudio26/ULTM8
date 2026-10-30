import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorBanner, Field, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { MoneyField } from '../lib/MoneyField';
import { useUpdateSchool, type SchoolResponse } from './schoolQueries';

/**
 * Decision 404: freezing memberships. The owner sets the most days a
 * membership can be frozen in any 12 months (default 90) and an optional
 * one-off fee, charged when a freeze is approved. Whether frozen members may
 * check in is one of the check-in rules (linked from here). Owner only, even
 * when Branch Staff may freeze (Decision 409).
 */
export function FreezeSettingsCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const update = useUpdateSchool(schoolId);
  const [maxDays, setMaxDays] = useState(String(school.freezeMaxDaysPer12Months ?? 90));
  const [fee, setFee] = useState<{ minorUnits: number | null; valid: boolean }>({ minorUnits: school.freezeFeeAmount ?? null, valid: true });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const max = Number(maxDays);
  const maxValid = Number.isInteger(max) && max >= 1 && max <= 365;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!maxValid || !fee.valid) return;
    setError(null);
    setSaved(false);
    try {
      const updated = await update.mutateAsync({ freezeMaxDaysPer12Months: max, freezeFeeAmount: fee.minorUnits || null });
      setMaxDays(String(updated.freezeMaxDaysPer12Months));
      setFee({ minorUnits: updated.freezeFeeAmount ?? null, valid: true });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} data-testid="freeze-settings">
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.freezing.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.freezing.subtitle')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <Field
          label={t('schools.freezing.maxDaysLabel')}
          htmlFor="freeze-max-days"
          hint={t('schools.freezing.maxDaysHint')}
          error={maxValid ? undefined : t('schools.freezing.maxDaysInvalid')}
        >
          <TextField
            id="freeze-max-days"
            type="number"
            min={1}
            max={365}
            step={1}
            required
            value={maxDays}
            onChange={(e) => {
              setMaxDays(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <Field
          label={t('schools.freezing.feeLabel')}
          htmlFor="freeze-fee"
          hint={t('schools.freezing.feeHint')}
          error={fee.valid ? undefined : t('schools.freezing.feeInvalid')}
        >
          <MoneyField
            id="freeze-fee"
            value={fee.minorUnits}
            currency={school.defaultCurrency}
            onChange={(minorUnits, valid) => {
              setFee({ minorUnits, valid });
              setSaved(false);
            }}
          />
        </Field>
        <p style={{ fontSize: 13, opacity: 0.75 }}>
          {t('schools.freezing.checkInNote')} <Link to="/check-in/rules">{t('schools.freezing.checkInLink')}</Link>
        </p>
        {/* Decision 409: a frozen card subscription is a trial in Stripe. */}
        <p style={{ fontSize: 13, opacity: 0.75 }} data-testid="freeze-stripe-note">
          {t('schools.freezing.stripeTrialNote')}
        </p>
        <Button type="submit" loading={update.isPending} disabled={!maxValid || !fee.valid}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}
