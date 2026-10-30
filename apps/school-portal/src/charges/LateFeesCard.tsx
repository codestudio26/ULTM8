import React, { useState } from 'react';
import { Button, Card, Checkbox, ErrorBanner, Field, SelectField, SuccessBanner, Switch, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { MoneyField } from '../lib/MoneyField';
import { rateText } from './chargeQueries';
import { parseGraceDays, parseLateFeePercent, useLateFeeSettings, useUpdateLateFeeSettings, type LateFeeSettings } from './lateFeeQueries';
import { CurrencyFirstNotice } from '../lib/CurrencyFirstNotice';

/**
 * Decision 413: late fees, the School's choice. Off by default. When on, a
 * charge or a card membership renewal still unpaid after the grace days gets
 * one late fee, a fixed amount or a % of what is still owed, added to the
 * member's balance (never charged to a card). The owner must confirm late
 * fees are legal where the School operates every time they save them on, as
 * for the card surcharge (Decision 406). Owner only, like the School page.
 */
export function LateFeesCard({ schoolId }: { schoolId: string }) {
  const { data } = useLateFeeSettings(schoolId);
  if (!data) return null;
  return <LateFeesForm key={schoolId} schoolId={schoolId} settings={data} />;
}

function LateFeesForm({ schoolId, settings }: { schoolId: string; settings: LateFeeSettings }) {
  const t = useT();
  const update = useUpdateLateFeeSettings(schoolId);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [type, setType] = useState<'FIXED' | 'PERCENT'>(settings.type);
  const [fixed, setFixed] = useState<{ minorUnits: number | null; valid: boolean }>({ minorUnits: settings.fixedAmount ?? null, valid: true });
  const [percent, setPercent] = useState(settings.percentBps ? rateText(settings.percentBps) : '');
  const [grace, setGrace] = useState(String(settings.graceDays));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const percentBps = percent.trim() === '' ? null : parseLateFeePercent(percent);
  const graceDays = parseGraceDays(grace);
  const fixedOk = fixed.valid && (fixed.minorUnits === null || fixed.minorUnits > 0);
  const percentOk = percent.trim() === '' || percentBps !== null;
  const changed = () => setSaved(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (graceDays === null) return setError(t('charges.lateFees.invalidGrace'));
    if (!fixedOk || (enabled && type === 'FIXED' && !fixed.minorUnits)) return setError(t('charges.lateFees.invalidAmount'));
    if (!percentOk || (enabled && type === 'PERCENT' && percentBps === null)) return setError(t('charges.lateFees.invalidPercent'));
    if (enabled && !confirmed) return setError(t('charges.lateFees.confirmRequired'));
    try {
      await update.mutateAsync({
        enabled,
        type,
        fixedAmount: fixed.minorUnits,
        percentBps,
        graceDays,
        ...(enabled ? { legalConfirmed: true } : {}),
      });
      setConfirmed(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <form id="late-fees" data-testid="late-fees-card" onSubmit={handleSubmit}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('charges.lateFees.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('charges.lateFees.subtitle')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <Switch
          id="late-fees-enabled"
          label={t('charges.lateFees.enabled')}
          checked={enabled}
          onChange={(v) => {
            setEnabled(v);
            changed();
          }}
        />
        <Field label={t('charges.lateFees.typeLabel')} htmlFor="late-fees-type">
          <SelectField
            id="late-fees-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as 'FIXED' | 'PERCENT');
              changed();
            }}
            options={[
              { value: 'FIXED', label: t('charges.lateFees.typeFixed') },
              { value: 'PERCENT', label: t('charges.lateFees.typePercent') },
            ]}
          />
        </Field>
        {/* Decision 414 item 6: no fixed amount until the School's currency is set. */}
        {type === 'FIXED' && !settings.currency ? <CurrencyFirstNotice /> : null}
        {type === 'FIXED' ? (
          <Field
            label={t('charges.lateFees.amountLabel')}
            htmlFor="late-fees-amount"
            error={fixedOk ? undefined : t('charges.lateFees.invalidAmount')}
          >
            <MoneyField
              id="late-fees-amount"
              disabled={!settings.currency}
              value={fixed.minorUnits}
              currency={settings.currency}
              onChange={(minorUnits, valid) => {
                setFixed({ minorUnits, valid });
                changed();
              }}
            />
          </Field>
        ) : (
          <Field
            label={t('charges.lateFees.percentLabel')}
            htmlFor="late-fees-percent"
            hint={t('charges.lateFees.percentHint')}
            error={percentOk ? undefined : t('charges.lateFees.invalidPercent')}
          >
            <TextField
              id="late-fees-percent"
              inputMode="decimal"
              value={percent}
              onChange={(e) => {
                setPercent(e.target.value);
                changed();
              }}
            />
          </Field>
        )}
        <Field
          label={t('charges.lateFees.graceLabel')}
          htmlFor="late-fees-grace"
          hint={t('charges.lateFees.graceHint')}
          error={graceDays === null ? t('charges.lateFees.invalidGrace') : undefined}
        >
          <TextField
            id="late-fees-grace"
            inputMode="numeric"
            value={grace}
            onChange={(e) => {
              setGrace(e.target.value);
              changed();
            }}
          />
        </Field>
        <p className="ultm8-field__hint" style={{ margin: '0 0 4px' }}>
          {t('charges.lateFees.taxNote')}
        </p>
        <p className="ultm8-field__hint" style={{ margin: '0 0 12px' }}>
          {t('charges.lateFees.notRetroactive')}
        </p>
        {enabled ? (
          <>
            <Checkbox id="late-fees-legal" label={t('charges.lateFees.legalConfirm')} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <p className="ultm8-field__hint" style={{ margin: '4px 0 0' }}>
              {t('charges.lateFees.legalHint')}
            </p>
          </>
        ) : null}
        <div style={{ marginTop: 16 }}>
          <Button type="submit" loading={update.isPending} disabled={enabled && !confirmed}>
            {t('schools.profile.saveChanges')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
