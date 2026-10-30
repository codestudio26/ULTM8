import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AddressFields, Button, Card, CurrencyField, ErrorBanner, Field, PageHeader, PhoneField, PhotoUploadField, SelectField, Spinner, SuccessBanner, TextField, TimezoneField, EMPTY_POSTAL_ADDRESS, hasLegacyAddressOnly, postalAddressFromRecord, preparePostalAddress, type PostalAddress, type PostalAddressErrors } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import { useBranch, useUpdateBranch, type BranchResponse } from './branchQueries';
import { useSchool } from '../schools/schoolQueries';
import { CancellationSettingsFields, cancellationSettingsForm, cancellationSettingsPayload, isCancellationSettingsValid, type CancellationSettingsForm } from '../cancellations/CancellationSettingsFields';
import { useT } from '../i18n/I18nProvider';
import { languageName } from '../i18n/format';

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
    address: EMPTY_POSTAL_ADDRESS as PostalAddress,
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
  const [initialAddress, setInitialAddress] = useState<PostalAddress | undefined>(undefined);
  const [addressErrors, setAddressErrors] = useState<PostalAddressErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-sync the form whenever a fresh Branch loads (first load, or after a
  // successful save re-fetches it) — same pattern CompleteInstructorProfilePage
  // and every other "fetch, then edit" page in this app does NOT need, since
  // those start blank; this one pre-fills from a real existing row.
  useEffect(() => {
    if (!branch) return;
    const address = postalAddressFromRecord(branch, guessDefaultCountry());
    setInitialAddress(address);
    setAddressErrors({});
    setForm({
      name: branch.name,
      address,
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
    const prepared = preparePostalAddress(form.address, initialAddress);
    if (!prepared.ok) {
      setAddressErrors(prepared.errors);
      return;
    }
    setAddressErrors({});
    try {
      // Explicit `null` clears a nullable field; activities/facilities always
      // send a real (possibly empty) array — same convention
      // UpdateBranchDto/UpdateFranchiseDto already established.
      await updateBranch.mutateAsync({
        name: form.name,
        postalAddress: prepared.postalAddress,
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
          <AddressFields
            idPrefix="branch-settings-address"
            value={form.address}
            onChange={(address) => setForm((f) => ({ ...f, address }))}
            errors={addressErrors}
            legacy={hasLegacyAddressOnly(branch) && !form.address.country}
          />
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
              options={[{ value: '', label: t('branches.form.notSet') }, ...(languages ?? []).map((l) => ({ value: l.code, label: languageName(l.code, l.name) }))]}
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
      <BranchCancellationSettingsCard branch={branch} />
    </>
  );
}

/**
 * Decision 292 — this Branch's own "Class cancellations" settings. Off (the
 * default) = same as the School, shown read-only; on = the Branch's own six
 * values apply to its classes. Turning it on starts from the School's
 * values. Its own Card and save, like the School page's.
 */
function BranchCancellationSettingsCard({ branch }: { branch: BranchResponse }) {
  const t = useT();
  const update = useUpdateBranch(branch.schoolId, branch.id);
  const { data: school } = useSchool(branch.schoolId);
  const [override, setOverride] = useState(branch.cancellationSettingsOverride);
  const [form, setForm] = useState<CancellationSettingsForm | null>(branch.cancellationSettingsOverride ? cancellationSettingsForm(branch) : null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!school) return null;
  const shown = override ? (form ?? cancellationSettingsForm(school)) : cancellationSettingsForm(school);

  function toggle(on: boolean) {
    setOverride(on);
    setSaved(false);
    if (on && !form) setForm(cancellationSettingsForm(school!));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (override && !isCancellationSettingsValid(shown)) return;
    try {
      await update.mutateAsync(
        override ? { cancellationSettingsOverride: true, ...cancellationSettingsPayload(shown) } : { cancellationSettingsOverride: false },
      );
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.cancellations.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('branches.cancellations.subtitle')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('branches.settingsPage.saved')} /> : null}
        <Field label={t('branches.cancellations.sourceLabel')} htmlFor="branch-cancel-source">
          <SelectField
            id="branch-cancel-source"
            value={override ? 'OWN' : 'SCHOOL'}
            onChange={(e) => toggle(e.target.value === 'OWN')}
            options={[
              { value: 'SCHOOL', label: t('branches.cancellations.sameAsSchool') },
              { value: 'OWN', label: t('branches.cancellations.own') },
            ]}
          />
        </Field>
        <CancellationSettingsFields form={shown} onChange={setForm} disabled={!override} currency={branch.currencyOverride || school.defaultCurrency} schoolCurrencyMissing={!school.defaultCurrency} />
        <div style={{ marginTop: 16 }}>
          <Button type="submit" loading={update.isPending}>
            {t('schools.profile.saveChanges')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
