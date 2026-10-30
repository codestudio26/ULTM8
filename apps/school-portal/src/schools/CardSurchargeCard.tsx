import React, { useState } from 'react';
import { Button, Card, Checkbox, ErrorBanner, Field, SuccessBanner, Switch, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useCardSurcharge, useUpdateCardSurcharge, type CardSurchargeSettings } from './cardSurchargeQueries';

/** "2.5" ↔ 250 basis points; at most two decimals, 0 to 3. */
function toBps(percent: string): number | null {
  const text = percent.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const bps = Math.round(Number(text) * 100);
  return bps <= 300 ? bps : null;
}

/**
 * Decision 406: a card surcharge on members' card payments, up to 3%. Shown
 * only when the School's country is one where ULTM8 allows it (the API
 * refuses it elsewhere); the owner must confirm it is legal where the School
 * operates every time they save it switched on. It is charged on one-off card
 * payments only, never on cash or a bank transfer.
 */
export function CardSurchargeCard({ schoolId }: { schoolId: string }) {
  const { data } = useCardSurcharge(schoolId);
  if (!data?.available) return null;
  return <CardSurchargeForm key={schoolId} schoolId={schoolId} settings={data} />;
}

function CardSurchargeForm({ schoolId, settings }: { schoolId: string; settings: CardSurchargeSettings }) {
  const t = useT();
  const update = useUpdateCardSurcharge(schoolId);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [percent, setPercent] = useState(settings.bps ? String(settings.bps / 100) : '');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const bps = percent.trim() === '' ? 0 : toBps(percent);
  const percentValid = bps !== null && (!enabled || bps >= 1);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!percentValid || bps === null) return setError(t('schools.cardSurcharge.invalidPercent'));
    if (enabled && !confirmed) return setError(t('schools.cardSurcharge.confirmRequired'));
    try {
      await update.mutateAsync({ enabled, bps, ...(enabled ? { legalConfirmed: true } : {}) });
      setConfirmed(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <form id="card-surcharge" onSubmit={handleSubmit}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.cardSurcharge.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.cardSurcharge.subtitle')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <Switch id="card-surcharge-enabled" label={t('schools.cardSurcharge.enabled')} checked={enabled} onChange={(v) => { setEnabled(v); setSaved(false); }} />
        <Field label={t('schools.cardSurcharge.percent')} htmlFor="card-surcharge-percent" hint={t('schools.cardSurcharge.percentHint')}>
          <TextField id="card-surcharge-percent" inputMode="decimal" value={percent} onChange={(e) => { setPercent(e.target.value); setSaved(false); }} />
        </Field>
        {enabled ? (
          <Checkbox
            id="card-surcharge-legal"
            label={t('schools.cardSurcharge.legalConfirm')}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
        ) : null}
        {settings.enabled && !settings.applies ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 0' }}>{t('schools.cardSurcharge.notApplying')}</p>
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
