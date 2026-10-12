import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useJoinFranchise, useLeaveFranchise, useSchool, useUpdateSchool } from './schoolQueries';

/** School Owner/Manager's own School profile — view + update (Spec §8.2: "Manage
 * their own School"). Field list matches UpdateSchoolDto exactly, same as
 * CreateSchoolPage. No delete action — general tenant offboarding is [UNRESOLVED]
 * (ultm8-domain-rules §2), and apps/api has no DELETE /schools endpoint to call. */
export function SchoolPage() {
  const schoolId = useOwnedSchoolId();
  const { data: school, isLoading, error: loadError } = useSchool(schoolId);
  const updateSchool = useUpdateSchool(schoolId ?? '');
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();

  const [form, setForm] = useState<{
    name: string;
    mobileNumber: string;
    address: string;
    businessType: string;
    activities: string;
    facilities: string;
    ranksToggle: boolean;
    defaultLanguage: string;
    defaultCurrency: string;
    timezone: string;
    description: string;
    classCancellationPolicy: 'MANUAL' | 'AUTO_REFUND' | 'AUTO_CREDIT';
    waitlistClaimWindowMinutes: number;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!school) return;
    setForm({
      name: school.name,
      mobileNumber: school.mobileNumber ?? '',
      address: school.address ?? '',
      businessType: school.businessType ?? '',
      activities: school.activities.join(', '),
      facilities: school.facilities.join(', '),
      ranksToggle: school.ranksToggle,
      defaultLanguage: school.defaultLanguage ?? '',
      defaultCurrency: school.defaultCurrency ?? '',
      timezone: school.timezone ?? '',
      description: school.description ?? '',
      classCancellationPolicy: school.classCancellationPolicy,
      waitlistClaimWindowMinutes: school.waitlistClaimWindowMinutes,
    });
  }, [school]);

  function set<K extends keyof NonNullable<typeof form>>(key: K, value: NonNullable<typeof form>[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaveError(null);
    setSaved(false);
    try {
      // `null` (not `undefined`) for a cleared field — UpdateSchoolDto accepts
      // null on these fields to mean "clear it" (FOUND ON REVIEW, Phase 18:
      // this exact "clearing a field silently no-ops" bug has been live since
      // Phase 3, see that DTO's own header comment). SchoolPage is edit-only
      // (School creation is CreateSchoolPage's own separate flow), so there's
      // no create-path mapping to undefined needed here.
      await updateSchool.mutateAsync({
        name: form.name,
        mobileNumber: form.mobileNumber || null,
        address: form.address || null,
        businessType: form.businessType || null,
        activities: form.activities.split(',').map((s) => s.trim()).filter(Boolean),
        facilities: form.facilities.split(',').map((s) => s.trim()).filter(Boolean),
        ranksToggle: form.ranksToggle,
        defaultLanguage: form.defaultLanguage || null,
        defaultCurrency: form.defaultCurrency || null,
        timezone: form.timezone || null,
        description: form.description || null,
        classCancellationPolicy: form.classCancellationPolicy,
        waitlistClaimWindowMinutes: form.waitlistClaimWindowMinutes,
      });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  if (isLoading || !form) return <Spinner />;
  if (loadError) return <ErrorBanner message={loadError instanceof ApiError ? loadError.message : 'Could not load your School.'} />;

  return (
    <>
      <PageHeader title="School profile" subtitle={school?.name} />
      <Card>
        <form onSubmit={handleSubmit}>
          {saveError ? <ErrorBanner message={saveError} /> : null}
          {saved ? <SuccessBanner message="Saved." /> : null}
          <Field label="School name" htmlFor="edit-name">
            <TextField required value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Mobile number" htmlFor="edit-mobile">
            <TextField value={form.mobileNumber} onChange={(e) => set('mobileNumber', e.target.value)} />
          </Field>
          <Field label="Address" htmlFor="edit-address">
            <TextField value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Business type" htmlFor="edit-businessType">
            <TextField value={form.businessType} onChange={(e) => set('businessType', e.target.value)} />
          </Field>
          <Field label="Activities" htmlFor="edit-activities" hint="Comma-separated">
            <TextField value={form.activities} onChange={(e) => set('activities', e.target.value)} />
          </Field>
          <Field label="Facilities" htmlFor="edit-facilities" hint="Comma-separated">
            <TextField value={form.facilities} onChange={(e) => set('facilities', e.target.value)} />
          </Field>
          <Field label="Default language" htmlFor="edit-language">
            <SelectField
              id="edit-language"
              value={form.defaultLanguage}
              onChange={(e) => set('defaultLanguage', e.target.value)}
              options={[{ value: '', label: 'Not set' }, ...(languages ?? []).map((l) => ({ value: l.code, label: l.name }))]}
            />
          </Field>
          <Field label="Default currency" htmlFor="edit-currency">
            <SelectField
              id="edit-currency"
              value={form.defaultCurrency}
              onChange={(e) => set('defaultCurrency', e.target.value)}
              options={[{ value: '', label: 'Not set' }, ...(currencies ?? []).map((c) => ({ value: c.code, label: c.name }))]}
            />
          </Field>
          <Field label="Timezone" htmlFor="edit-timezone" hint="IANA name, e.g. America/New_York. Used for classes without a branch timezone.">
            <TextField value={form.timezone} onChange={(e) => set('timezone', e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="edit-description">
            <TextField value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Class cancellation policy" htmlFor="edit-policy">
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
          <Field label="Waitlist claim window (minutes)" htmlFor="edit-waitlist">
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
            <Button type="submit" loading={updateSchool.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>
      {schoolId && school ? <FranchiseAffiliationCard schoolId={schoolId} franchiseId={school.franchiseId ?? null} /> : null}
    </>
  );
}

/**
 * Decision 232 — leave/switch-Franchise, on top of Decision 98's own one-way-only
 * join-franchise endpoint. "Switch" is deliberately not a separate action here
 * either — leaving, then joining a different Franchise, same as the backend
 * (SchoolsService.leaveFranchise's own header comment). No "browse Franchises to
 * join" UI exists anywhere in this codebase (join-franchise never had one before
 * this phase) — a School Owner enters the Franchise's id directly, same shape the
 * API itself has always taken.
 */
function FranchiseAffiliationCard({ schoolId, franchiseId }: { schoolId: string; franchiseId: string | null }) {
  const joinFranchise = useJoinFranchise(schoolId);
  const leaveFranchise = useLeaveFranchise(schoolId);
  const [franchiseIdInput, setFranchiseIdInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await joinFranchise.mutateAsync(franchiseIdInput);
      setFranchiseIdInput('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  async function handleLeave() {
    setError(null);
    try {
      await leaveFranchise.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
        Franchise affiliation
      </h2>
      {error ? <ErrorBanner message={error} /> : null}
      {franchiseId ? (
        <>
          <p>
            Affiliated with Franchise <Badge>{franchiseId}</Badge>
          </p>
          <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>
            Leaving cancels any standing franchise-fee billing for this School. To switch, leave first, then join the
            new Franchise below.
          </p>
          <Button variant="danger" onClick={handleLeave} loading={leaveFranchise.isPending}>
            Leave Franchise
          </Button>
        </>
      ) : (
        <>
          <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>
            This School is independent — not affiliated with any Franchise.
          </p>
          <form onSubmit={handleJoin}>
            <Field label="Franchise ID" htmlFor="join-franchise-id">
              <TextField required value={franchiseIdInput} onChange={(e) => setFranchiseIdInput(e.target.value)} />
            </Field>
            <Button type="submit" loading={joinFranchise.isPending}>
              Join Franchise
            </Button>
          </form>
        </>
      )}
    </Card>
  );
}
