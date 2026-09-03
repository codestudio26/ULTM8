import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthCard, Button, Checkbox, ErrorBanner, Field, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth } from '../auth/AuthContext';
import { useCreateSchool } from './schoolQueries';

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
  const { logout, setAccessToken } = useAuth();
  const navigate = useNavigate();
  const createSchool = useCreateSchool();

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
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  if (created) {
    return (
      <AuthCard title="School created" subtitle="You're now its Owner/Manager.">
        <p>
          Your access token doesn't reflect your new role until you log in again — session claims are only
          rebuilt at login (there's no live-refresh mechanism yet). Please log back in to continue.
        </p>
        <Button fullWidth onClick={logout}>
          Log out and log back in
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your School" subtitle="You'll become its Owner/Manager automatically.">
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="School name" htmlFor="school-name">
          <TextField required value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Mobile number" htmlFor="school-mobile">
          <TextField value={form.mobileNumber} onChange={(e) => set('mobileNumber', e.target.value)} />
        </Field>
        <Field label="Address" htmlFor="school-address">
          <TextField value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Business type" htmlFor="school-businessType">
          <TextField value={form.businessType} onChange={(e) => set('businessType', e.target.value)} />
        </Field>
        <Field label="Activities" htmlFor="school-activities" hint="Comma-separated, e.g. Jiu Jitsu, Karate">
          <TextField value={form.activities} onChange={(e) => set('activities', e.target.value)} />
        </Field>
        <Field label="Facilities" htmlFor="school-facilities" hint="Comma-separated">
          <TextField value={form.facilities} onChange={(e) => set('facilities', e.target.value)} />
        </Field>
        <Field label="Default language" htmlFor="school-language">
          <TextField value={form.defaultLanguage} onChange={(e) => set('defaultLanguage', e.target.value)} />
        </Field>
        <Field label="Default currency" htmlFor="school-currency">
          <TextField value={form.defaultCurrency} onChange={(e) => set('defaultCurrency', e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="school-description">
          <TextField value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Class cancellation policy" htmlFor="school-policy">
          <SelectField
            value={form.classCancellationPolicy}
            onChange={(e) => set('classCancellationPolicy', e.target.value as typeof form.classCancellationPolicy)}
            options={[
              { value: 'MANUAL', label: 'Manual (default)' },
              { value: 'AUTO_REFUND', label: 'Auto-Refund' },
              { value: 'AUTO_CREDIT', label: 'Auto-Credit' },
            ]}
          />
        </Field>
        <Field label="Waitlist claim window (minutes)" htmlFor="school-waitlist">
          <TextField
            type="number"
            min={1}
            value={form.waitlistClaimWindowMinutes}
            onChange={(e) => set('waitlistClaimWindowMinutes', Number(e.target.value))}
          />
        </Field>
        <Checkbox
          label="Enable belt/rank tracking"
          checked={form.ranksToggle}
          onChange={(e) => set('ranksToggle', e.target.checked)}
        />
        <div style={{ marginTop: 16 }}>
          <Button type="submit" fullWidth loading={createSchool.isPending}>
            Create School
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
