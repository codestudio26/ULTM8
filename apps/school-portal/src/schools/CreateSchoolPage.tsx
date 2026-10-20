import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthCard, Button, Checkbox, CurrencyField, ErrorBanner, Field, PhoneField, SelectField, TextField, TimezoneField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth } from '../auth/AuthContext';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useCreateSchool } from './schoolQueries';
import { useT } from '../i18n/I18nProvider';

/**
 * Self-service School creation (Decision 79) — the creator becomes SCHOOL_OWNER_MANAGER
 * automatically, server-side, in the same transaction as the School row itself.
 *
 * Fields match CreateSchoolDto exactly (apps/api/src/tenants/schools/dto/
 * create-school.dto.ts), re-verified against that file before writing this — not
 * reverse-inferred from the createSchoolProfile Figma screen, which is layout
 * reference only per CLAUDE.md's standing rule. franchiseId and
 * franchiseFeeSubscriptionStatus are correctly absent — the DTO doesn't accept them
 * (see that file's own header comment on why).
 */
export function CreateSchoolPage() {
  const t = useT();
  const { logout, setAccessToken } = useAuth();
  const navigate = useNavigate();
  const createSchool = useCreateSchool();
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();

  const [form, setForm] = useState({
    name: '',
    mobileNumber: '',
    address: '',
    businessType: '',
    activities: '',
    facilities: '',
    ranksToggle: false,
    defaultLanguage: '',
    defaultCurrency: '',
    timezone: '',
    description: '',
    classCancellationPolicy: 'MANUAL' as 'MANUAL' | 'AUTO_REFUND' | 'AUTO_CREDIT',
    waitlistClaimWindowMinutes: 120,
  });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await createSchool.mutateAsync({
        name: form.name,
        mobileNumber: form.mobileNumber || undefined,
        address: form.address || undefined,
        businessType: form.businessType || undefined,
        activities: form.activities ? form.activities.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        facilities: form.facilities ? form.facilities.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        ranksToggle: form.ranksToggle,
        defaultLanguage: form.defaultLanguage || undefined,
        defaultCurrency: form.defaultCurrency || undefined,
        timezone: form.timezone || undefined,
        description: form.description || undefined,
        classCancellationPolicy: form.classCancellationPolicy,
        waitlistClaimWindowMinutes: form.waitlistClaimWindowMinutes,
      });
      // SchoolsService.create() re-mints the caller's own token and returns it
      // (ultm8-nestjs-module §7's narrow, approved exception) — swap it in directly so
      // the new SCHOOL_OWNER_MANAGER grant is reflected immediately, no log-out/back-in
      // needed. Defensive fallback if the field is ever absent: don't assume it's
      // always there just because it should be — fall back to the old workaround
      // rather than erroring or silently stranding the user on this screen.
      if (result.accessToken) {
        setAccessToken(result.accessToken);
        navigate('/school', { replace: true });
      } else {
        setCreated(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  if (created) {
    return (
      <AuthCard title={t('schools.create.createdTitle')} subtitle={t('schools.create.createdSubtitle')}>
        <p>{t('schools.create.reloginBody')}</p>
        <Button fullWidth onClick={logout}>
          {t('schools.create.reloginButton')}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('schools.create.title')} subtitle={t('schools.create.subtitle')}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('schools.form.schoolName')} htmlFor="school-name">
          <TextField required value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('schools.form.mobileNumber')} htmlFor="school-mobile">
          <PhoneField value={form.mobileNumber} onChange={(v) => set('mobileNumber', v)} defaultCountry={guessDefaultCountry()} />
        </Field>
        <Field label={t('schools.form.address')} htmlFor="school-address">
          <TextField value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label={t('schools.form.businessType')} htmlFor="school-businessType">
          <TextField value={form.businessType} onChange={(e) => set('businessType', e.target.value)} />
        </Field>
        <Field label={t('schools.form.activities')} htmlFor="school-activities" hint={t('schools.form.activitiesHintExample')}>
          <TextField value={form.activities} onChange={(e) => set('activities', e.target.value)} />
        </Field>
        <Field label={t('schools.form.facilities')} htmlFor="school-facilities" hint={t('schools.form.commaSeparated')}>
          <TextField value={form.facilities} onChange={(e) => set('facilities', e.target.value)} />
        </Field>
        <Field label={t('schools.form.defaultLanguage')} htmlFor="school-language">
          <SelectField
            id="school-language"
            value={form.defaultLanguage}
            onChange={(e) => set('defaultLanguage', e.target.value)}
            options={[{ value: '', label: t('schools.form.notSet') }, ...(languages ?? []).map((l) => ({ value: l.code, label: l.name }))]}
          />
        </Field>
        <Field label={t('schools.form.defaultCurrency')} htmlFor="school-currency">
          <CurrencyField
            id="school-currency"
            value={form.defaultCurrency}
            onChange={(code) => set('defaultCurrency', code)}
            options={[{ code: '', name: t('schools.form.notSet') }, ...(currencies ?? [])]}
            placeholder={t('schools.form.notSet')}
          />
        </Field>
        <Field label={t('schools.form.timezone')} htmlFor="school-timezone" hint={t('schools.form.timezoneHint')}>
          <TimezoneField value={form.timezone} onChange={(timezone) => set('timezone', timezone)} />
        </Field>
        <Field label={t('schools.form.description')} htmlFor="school-description">
          <TextField value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label={t('schools.form.cancellationPolicy')} htmlFor="school-policy">
          <SelectField
            value={form.classCancellationPolicy}
            onChange={(e) => set('classCancellationPolicy', e.target.value as typeof form.classCancellationPolicy)}
            options={[
              { value: 'MANUAL', label: t('schools.form.policyManual') },
              { value: 'AUTO_REFUND', label: t('schools.form.policyAutoRefund') },
              { value: 'AUTO_CREDIT', label: t('schools.form.policyAutoCredit') },
            ]}
          />
        </Field>
        <Field label={t('schools.form.waitlistWindow')} htmlFor="school-waitlist">
          <TextField
            type="number"
            min={1}
            value={form.waitlistClaimWindowMinutes}
            onChange={(e) => set('waitlistClaimWindowMinutes', Number(e.target.value))}
          />
        </Field>
        <Checkbox
          label={t('schools.form.ranksToggle')}
          checked={form.ranksToggle}
          onChange={(e) => set('ranksToggle', e.target.checked)}
        />
        <div style={{ marginTop: 16 }}>
          <Button type="submit" fullWidth loading={createSchool.isPending}>
            {t('schools.create.submit')}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
