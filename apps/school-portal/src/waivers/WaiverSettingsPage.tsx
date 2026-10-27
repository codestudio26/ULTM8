import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button, Card, ErrorBanner, PageHeader, Spinner, SuccessBanner, Switch, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useUpdateWaiverSettings, useWaiverSettings, type WaiverSettings } from './waiverQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

type Toggle = 'archivedCount' | 'adult' | 'paper' | 'joinNotice';

const TOGGLE_FIELD: Record<Toggle, 'waiverArchivedSignaturesCount' | 'waiverMinorsSignAgainAt18' | 'waiverPaperSignaturesAllowed' | 'waiverNoticeOnJoin'> = {
  archivedCount: 'waiverArchivedSignaturesCount',
  adult: 'waiverMinorsSignAgainAt18',
  paper: 'waiverPaperSignaturesAllowed',
  joinNotice: 'waiverNoticeOnJoin',
};

type Form = {
  waiverArchivedSignaturesCount: boolean;
  waiverMinorsSignAgainAt18: boolean;
  waiverPaperSignaturesAllowed: boolean;
  waiverNoticeOnJoin: boolean;
  renewalOn: boolean;
  renewalMonths: string;
  remindersOn: boolean;
  reminderDays: string;
};

/** Suggested numbers when a School turns a timed setting on. */
const DEFAULT_RENEWAL_MONTHS = 12;
const DEFAULT_REMINDER_DAYS = 7;

function toForm(s: WaiverSettings): Form {
  return {
    waiverArchivedSignaturesCount: s.waiverArchivedSignaturesCount,
    waiverMinorsSignAgainAt18: s.waiverMinorsSignAgainAt18,
    waiverPaperSignaturesAllowed: s.waiverPaperSignaturesAllowed,
    waiverNoticeOnJoin: s.waiverNoticeOnJoin,
    renewalOn: s.waiverRenewalMonths != null,
    renewalMonths: String(s.waiverRenewalMonths ?? DEFAULT_RENEWAL_MONTHS),
    remindersOn: s.waiverReminderDays != null,
    reminderDays: String(s.waiverReminderDays ?? DEFAULT_REMINDER_DAYS),
  };
}

const wholeIn = (value: string, min: number, max: number) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;

/**
 * Waivers → Settings (Decision 354): how waivers work at this School. The
 * Owner and Managers choose; each setting explains both choices and what most
 * schools pick, since there is no single right answer.
 */
export function WaiverSettingsPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const settings = useWaiverSettings(schoolId);
  const update = useUpdateWaiverSettings(schoolId ?? '');
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(toForm(settings.data));
  }, [settings.data]);

  if (!schoolId) return <Navigate to="/" replace />;
  if (settings.isLoading || (!form && !settings.error)) return <Spinner />;
  if (settings.error || !form || !settings.data) {
    return <ErrorBanner message={settings.error instanceof ApiError ? settings.error.message : t('waivers.settings.loadFailed')} />;
  }

  const current = toForm(settings.data);
  const dirty = (Object.keys(form) as Array<keyof Form>).some((k) => form[k] !== current[k]);
  const monthsBad = form.renewalOn && !wholeIn(form.renewalMonths, 1, 120);
  const daysBad = form.remindersOn && !wholeIn(form.reminderDays, 1, 90);

  async function save() {
    if (!form) return;
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync({
        waiverArchivedSignaturesCount: form.waiverArchivedSignaturesCount,
        waiverMinorsSignAgainAt18: form.waiverMinorsSignAgainAt18,
        waiverPaperSignaturesAllowed: form.waiverPaperSignaturesAllowed,
        waiverNoticeOnJoin: form.waiverNoticeOnJoin,
        waiverRenewalMonths: form.renewalOn ? Number(form.renewalMonths) : null,
        waiverReminderDays: form.remindersOn ? Number(form.reminderDays) : null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  const advice = (key: string) => (
    <p className="ultm8-field__hint" style={{ margin: '4px 0 0' }}>
      {t(`waivers.settings.${key}.advice` as TranslationKey)}
    </p>
  );

  const toggle = (key: Toggle) => {
    const field = TOGGLE_FIELD[key];
    return (
      <div>
        <Switch
          id={`waiver-setting-${key}`}
          label={t(`waivers.settings.${key}.label` as TranslationKey)}
          description={t(`waivers.settings.${key}.${form[field] ? 'on' : 'off'}` as TranslationKey)}
          checked={form[field]}
          onChange={(v) => setForm((f) => (f ? { ...f, [field]: v } : f))}
        />
        {advice(key)}
      </div>
    );
  };

  const timed = (key: 'renewal' | 'reminders', onField: 'renewalOn' | 'remindersOn', numberField: 'renewalMonths' | 'reminderDays', unit: 'months' | 'days', bad: boolean) => (
    <div>
      <Switch
        id={`waiver-setting-${key}`}
        label={t(`waivers.settings.${key}.label` as TranslationKey)}
        description={t(`waivers.settings.${key}.${form[onField] ? 'on' : 'off'}` as TranslationKey)}
        checked={form[onField]}
        onChange={(v) => setForm((f) => (f ? { ...f, [onField]: v } : f))}
      />
      {form[onField] ? (
        <label className="ultm8-settings-inline" style={{ marginTop: 8 }}>
          {t(`waivers.settings.${key}.${unit}` as TranslationKey)}
          <TextField
            type="number"
            min={1}
            max={unit === 'months' ? 120 : 90}
            value={form[numberField]}
            aria-label={t(`waivers.settings.${key}.${unit}` as TranslationKey)}
            onChange={(e) => setForm((f) => (f ? { ...f, [numberField]: e.target.value } : f))}
          />
        </label>
      ) : null}
      {bad ? (
        <p role="alert" className="ultm8-field__error" style={{ margin: '4px 0 0' }}>
          {t(`waivers.settings.${key}.invalid` as TranslationKey)}
        </p>
      ) : null}
      {advice(key)}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('waivers.settings.title')}
        subtitle={t('waivers.settings.subtitle')}
        actions={<Link to="/waivers">{t('waivers.settings.back')}</Link>}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {saved && !dirty ? <SuccessBanner message={t('waivers.settings.saved')} /> : null}
      <Card>
        <div style={{ display: 'grid', gap: 20, maxWidth: '70ch' }}>
          {toggle('archivedCount')}
          {timed('renewal', 'renewalOn', 'renewalMonths', 'months', monthsBad)}
          {toggle('adult')}
          {toggle('paper')}
          {toggle('joinNotice')}
          {timed('reminders', 'remindersOn', 'reminderDays', 'days', daysBad)}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <Button onClick={save} loading={update.isPending} disabled={!dirty || monthsBad || daysBad}>
            {t('waivers.settings.saveChanges')}
          </Button>
          <Button variant="secondary" disabled={!dirty} onClick={() => setForm(current)}>
            {t('waivers.settings.discard')}
          </Button>
        </div>
      </Card>
    </>
  );
}
