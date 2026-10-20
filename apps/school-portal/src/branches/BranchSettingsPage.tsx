import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, CurrencyField, ErrorBanner, Field, PageHeader, PhoneField, PhotoUploadField, SelectField, Spinner, SuccessBanner, TextField, TimezoneField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import { useBranch, useUpdateBranch } from './branchQueries';
import { useT } from '../i18n/I18nProvider';

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
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const branchId = id ?? null;
  const navigate = useNavigate();
  const { data: branch, isLoading, error } = useBranch(branchId);
  const updateBranch = useUpdateBranch(branch?.schoolId ?? '', branchId ?? '');
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();

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
    return <ErrorBanner message={error instanceof ApiError ? error.message : t('branches.settingsPage.loadFailed')} />;
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
      setSaveError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <>
      <PageHeader
        title={branch.name}
        subtitle={t('branches.settingsPage.subtitle')}
        actions={
          <Button variant="secondary" onClick={() => navigate('/branches')}>
            {t('branches.settingsPage.back')}
          </Button>
        }
      />
      {saved ? <SuccessBanner message={t('branches.settingsPage.saved')} /> : null}
      {saveError ? <ErrorBanner message={saveError} /> : null}
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label={t('branches.form.branchName')} htmlFor="branch-settings-name">
            <TextField required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label={t('branches.form.address')} htmlFor="branch-settings-address">
            <TextField value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </Field>
          <Field label={t('branches.form.contactPhone')} htmlFor="branch-settings-phone">
            <PhoneField
              value={form.contactPhone}
              onChange={(v) => setForm((f) => ({ ...f, contactPhone: v }))}
              defaultCountry={guessDefaultCountry()}
            />
          </Field>
          <Field label={t('branches.form.timezone')} htmlFor="branch-settings-timezone">
            <TimezoneField value={form.timezone} onChange={(timezone) => setForm((f) => ({ ...f, timezone }))} />
          </Field>
          <Field label={t('branches.form.currencyOverride')} htmlFor="branch-settings-currency">
            <CurrencyField
              id="branch-settings-currency"
              value={form.currencyOverride}
              onChange={(code) => setForm((f) => ({ ...f, currencyOverride: code }))}
              options={[{ code: '', name: t('branches.form.notSet') }, ...(currencies ?? [])]}
              placeholder={t('branches.form.notSet')}
            />
          </Field>
          <Field label={t('branches.form.type')} htmlFor="branch-settings-type">
            <TextField value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} />
          </Field>
          <Field label={t('branches.form.activities')} htmlFor="branch-settings-activities" hint={t('branches.form.activitiesHint')}>
            <TextField value={form.activities} onChange={(e) => setForm((f) => ({ ...f, activities: e.target.value }))} />
          </Field>
          <Field label={t('branches.form.facilities')} htmlFor="branch-settings-facilities" hint={t('branches.form.commaSeparated')}>
            <TextField value={form.facilities} onChange={(e) => setForm((f) => ({ ...f, facilities: e.target.value }))} />
          </Field>
          <Field label={t('branches.form.defaultLanguage')} htmlFor="branch-settings-language">
            <SelectField
              id="branch-settings-language"
              value={form.defaultLanguage}
              onChange={(e) => setForm((f) => ({ ...f, defaultLanguage: e.target.value }))}
              options={[{ value: '', label: t('branches.form.notSet') }, ...(languages ?? []).map((l) => ({ value: l.code, label: l.name }))]}
            />
          </Field>
          <Field label={t('branches.form.description')} htmlFor="branch-settings-description">
            <TextField value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label={t('branches.form.logo')} htmlFor="branch-settings-logo">
            <PhotoUploadField
              value={form.logoUrl}
              onChange={(logoUrl) => setForm((f) => ({ ...f, logoUrl }))}
              requestUpload={(file) =>
                requestPhotoUpload.mutateAsync({
                  entityType: 'BRANCH',
                  schoolId: branch.schoolId,
                  entityId: branch.id,
                  contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
                })
              }
            />
          </Field>
          <Field label={t('branches.form.banner')} htmlFor="branch-settings-banner">
            <PhotoUploadField
              value={form.bannerUrl}
              onChange={(bannerUrl) => setForm((f) => ({ ...f, bannerUrl }))}
              requestUpload={(file) =>
                requestPhotoUpload.mutateAsync({
                  entityType: 'BRANCH',
                  schoolId: branch.schoolId,
                  entityId: branch.id,
                  contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
                })
              }
            />
          </Field>
          <Button type="submit" loading={updateBranch.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </Card>
    </>
  );
}
