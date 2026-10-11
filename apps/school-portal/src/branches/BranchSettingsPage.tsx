import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useBranch, useUpdateBranch } from './branchQueries';

/**
 * Decision 231 — a dedicated Branch settings screen, replacing the previous
 * modal-only edit path (BranchesPage.tsx's "Edit" button now navigates here
 * instead of opening a Modal). Fields match
 * CreateBranchDto/UpdateBranchDto/BranchResponseDto exactly, re-verified
 * before writing this — the original six (Decision 76) plus this decision's
 * four additions (`type`/`activities`/`facilities`/`defaultLanguage`/
 * `description`), mirroring FranchiseFormModal's own treatment of the same
 * four field names/types.
 */
export function BranchSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const branchId = id ?? null;
  const navigate = useNavigate();
  const { data: branch, isLoading, error } = useBranch(branchId);
  const updateBranch = useUpdateBranch(branch?.schoolId ?? '', branchId ?? '');
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();

  const [form, setForm] = useState({
    name: '',
    address: '',
    contactPhone: '',
    timezone: '',
    currencyOverride: '',
    type: '',
    activities: '',
    facilities: '',
    defaultLanguage: '',
    description: '',
    logoUrl: '',
    bannerUrl: '',
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-sync the form whenever a fresh Branch loads (first load, or after a
  // successful save re-fetches it) — same pattern CompleteInstructorProfilePage
  // and every other "fetch, then edit" page in this app does NOT need, since
  // those start blank; this one pre-fills from a real existing row.
  useEffect(() => {
    if (!branch) return;
    setForm({
      name: branch.name,
      address: branch.address ?? '',
      contactPhone: branch.contactPhone ?? '',
      timezone: branch.timezone ?? '',
      currencyOverride: branch.currencyOverride ?? '',
      type: branch.type ?? '',
      activities: branch.activities.join(', '),
      facilities: branch.facilities.join(', '),
      defaultLanguage: branch.defaultLanguage ?? '',
      description: branch.description ?? '',
      logoUrl: branch.logoUrl ?? '',
      bannerUrl: branch.bannerUrl ?? '',
    });
  }, [branch]);

  if (!branchId) return null;
  if (isLoading) return <Spinner />;
  if (error) {
    return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load this Branch.'} />;
  }
  if (!branch) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    try {
      // Explicit `null` clears a nullable field; activities/facilities always
      // send a real (possibly empty) array — same convention
      // UpdateBranchDto/UpdateFranchiseDto already established.
      await updateBranch.mutateAsync({
        name: form.name,
        address: form.address || null,
        contactPhone: form.contactPhone || null,
        timezone: form.timezone || null,
        currencyOverride: form.currencyOverride || null,
        type: form.type || null,
        activities: form.activities.split(',').map((s) => s.trim()).filter(Boolean),
        facilities: form.facilities.split(',').map((s) => s.trim()).filter(Boolean),
        defaultLanguage: form.defaultLanguage || null,
        description: form.description || null,
        logoUrl: form.logoUrl || null,
        bannerUrl: form.bannerUrl || null,
      });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <>
      <PageHeader
        title={branch.name}
        subtitle="Branch settings"
        actions={
          <Button variant="secondary" onClick={() => navigate('/branches')}>
            Back to Branches
          </Button>
        }
      />
      {saved ? <SuccessBanner message="Branch settings saved." /> : null}
      {saveError ? <ErrorBanner message={saveError} /> : null}
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label="Branch name" htmlFor="branch-settings-name">
            <TextField required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Address" htmlFor="branch-settings-address">
            <TextField value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </Field>
          <Field label="Contact phone" htmlFor="branch-settings-phone">
            <TextField value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
          </Field>
          <Field label="Timezone" htmlFor="branch-settings-timezone" hint="IANA name, e.g. America/New_York">
            <TextField value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} />
          </Field>
          <Field label="Currency override" htmlFor="branch-settings-currency">
            <SelectField
              id="branch-settings-currency"
              value={form.currencyOverride}
              onChange={(e) => setForm((f) => ({ ...f, currencyOverride: e.target.value }))}
              options={[{ value: '', label: 'Not set' }, ...(currencies ?? []).map((c) => ({ value: c.code, label: c.name }))]}
            />
          </Field>
          <Field label="Type" htmlFor="branch-settings-type">
            <TextField value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} />
          </Field>
          <Field label="Activities" htmlFor="branch-settings-activities" hint="Comma-separated, e.g. BJJ, Judo">
            <TextField value={form.activities} onChange={(e) => setForm((f) => ({ ...f, activities: e.target.value }))} />
          </Field>
          <Field label="Facilities" htmlFor="branch-settings-facilities" hint="Comma-separated">
            <TextField value={form.facilities} onChange={(e) => setForm((f) => ({ ...f, facilities: e.target.value }))} />
          </Field>
          <Field label="Default language" htmlFor="branch-settings-language">
            <SelectField
              id="branch-settings-language"
              value={form.defaultLanguage}
              onChange={(e) => setForm((f) => ({ ...f, defaultLanguage: e.target.value }))}
              options={[{ value: '', label: 'Not set' }, ...(languages ?? []).map((l) => ({ value: l.code, label: l.name }))]}
            />
          </Field>
          <Field label="Description" htmlFor="branch-settings-description">
            <TextField value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label="Logo URL" htmlFor="branch-settings-logo">
            <TextField value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} />
          </Field>
          <Field label="Banner URL" htmlFor="branch-settings-banner">
            <TextField value={form.bannerUrl} onChange={(e) => setForm((f) => ({ ...f, bannerUrl: e.target.value }))} />
          </Field>
          <Button type="submit" loading={updateBranch.isPending}>
            Save
          </Button>
        </form>
      </Card>
    </>
  );
}
