import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Spinner, Switch, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useUpdateWaiverSettings, useWaiverSettings, type WaiverSettings } from './waiverQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { Note, Pill } from './WaiversLook';
import './waivers.css';

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
  childSignsOn: boolean;
  childSignsAge: string;
};

/** Suggested numbers when a School turns a timed setting on. */
const DEFAULT_RENEWAL_MONTHS = 12;
const DEFAULT_REMINDER_DAYS = 7;
const DEFAULT_CHILD_SIGNS_AGE = 16;

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
    childSignsOn: s.waiverChildSignsFromAge != null,
    childSignsAge: String(s.waiverChildSignsFromAge ?? DEFAULT_CHILD_SIGNS_AGE),
  };
}

/** The largest number each timed setting takes (the API's limits). */
const NUMBER_MAX = { months: 120, days: 90, age: 17 } as const;

const wholeIn = (value: string, min: number, max: number) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;

/**
 * Waivers → Settings (Decision 354): how waivers work at this School. The
 * Owner and Managers choose; each setting explains both choices and what most
 * schools pick, since there is no single right answer.
 *
 * In the new look (Decision 453). The approved design draws no waiver
 * settings screen, so this keeps the page's layout and only restyles it, in
 * the Waivers page's pieces (WaiversLook.tsx, waivers.css): the white page
 * header with "‹ Back to waivers", the settings in one white card with
 * Save changes / Discard as a button pair under them, and the retention rule
 * in a second card.
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

  const header = (
    <NewLookPageHeader
      title={t('waivers.settings.title')}
      subtitle={t('waivers.settings.subtitle')}
      parent={{ to: '/waivers', label: t('waivers.settings.back') }}
    />
  );
  const frame = (content: React.ReactNode) => (
    <div className="u8w">
      {header}
      <NewLookPage>
        <div className="u8ws">{content}</div>
      </NewLookPage>
    </div>
  );

  if (settings.isLoading || (!form && !settings.error)) return frame(<Spinner />);
  if (settings.error || !form || !settings.data) {
    return frame(<Note kind="error" message={settings.error instanceof ApiError ? settings.error.message : t('waivers.settings.loadFailed')} />);
  }

  const current = toForm(settings.data);
  const dirty = (Object.keys(form) as Array<keyof Form>).some((k) => form[k] !== current[k]);
  const monthsBad = form.renewalOn && !wholeIn(form.renewalMonths, 1, 120);
  const daysBad = form.remindersOn && !wholeIn(form.reminderDays, 1, 90);
  const ageBad = form.childSignsOn && !wholeIn(form.childSignsAge, 1, 17);

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
        waiverChildSignsFromAge: form.childSignsOn ? Number(form.childSignsAge) : null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  const advice = (key: string) => (
    <p className="u8ws-advice">
      {t(`waivers.settings.${key}.advice` as TranslationKey)}
    </p>
  );

  const toggle = (key: Toggle) => {
    const field = TOGGLE_FIELD[key];
    return (
      <div className="u8ws-setting">
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

  const timed = (
    key: 'renewal' | 'reminders' | 'childSigns',
    onField: 'renewalOn' | 'remindersOn' | 'childSignsOn',
    numberField: 'renewalMonths' | 'reminderDays' | 'childSignsAge',
    unit: 'months' | 'days' | 'age',
    bad: boolean,
  ) => (
    <div className="u8ws-setting">
      <Switch
        id={`waiver-setting-${key}`}
        label={t(`waivers.settings.${key}.label` as TranslationKey)}
        description={t(`waivers.settings.${key}.${form[onField] ? 'on' : 'off'}` as TranslationKey)}
        checked={form[onField]}
        onChange={(v) => setForm((f) => (f ? { ...f, [onField]: v } : f))}
      />
      {form[onField] ? (
        <label className="u8ws-number">
          {t(`waivers.settings.${key}.${unit}` as TranslationKey)}
          <TextField
            type="number"
            min={1}
            max={NUMBER_MAX[unit]}
            value={form[numberField]}
            aria-invalid={bad || undefined}
            aria-label={t(`waivers.settings.${key}.${unit}` as TranslationKey)}
            onChange={(e) => setForm((f) => (f ? { ...f, [numberField]: e.target.value } : f))}
          />
        </label>
      ) : null}
      {bad ? (
        <p role="alert" className="u8ws-invalid">
          {t(`waivers.settings.${key}.invalid` as TranslationKey)}
        </p>
      ) : null}
      {advice(key)}
    </div>
  );

  return frame(
    <>
      {error ? <Note kind="error" message={error} /> : null}
      {saved && !dirty ? <Note kind="success" message={t('waivers.settings.saved')} /> : null}
      <section className="u8w-card u8ws-card" aria-label={t('waivers.settings.title')}>
        <div className="u8ws-list">
          {toggle('archivedCount')}
          {timed('renewal', 'renewalOn', 'renewalMonths', 'months', monthsBad)}
          {toggle('adult')}
          {timed('childSigns', 'childSignsOn', 'childSignsAge', 'age', ageBad)}
          {toggle('paper')}
          {toggle('joinNotice')}
          {timed('reminders', 'remindersOn', 'reminderDays', 'days', daysBad)}
        </div>
        <div className="u8w-pair u8ws-actions">
          <Pill primary onClick={save} loading={update.isPending} disabled={!dirty || monthsBad || daysBad || ageBad}>
            {t('waivers.settings.saveChanges')}
          </Pill>
          <Pill disabled={!dirty} onClick={() => setForm(current)}>
            {t('waivers.settings.discard')}
          </Pill>
        </div>
      </section>
      {/* Decision 426: one platform-wide rule, not a School setting. */}
      <section className="u8w-card u8ws-card u8ws-retention">
        <h2 className="u8ws-heading">{t('waivers.retention.heading')}</h2>
        <p>{t('waivers.retention.note')}</p>
      </section>
    </>,
  );
}
