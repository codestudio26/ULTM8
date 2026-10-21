import React, { useState } from 'react';
import { Button, Card, CurrencyField, ErrorBanner, Field, PageHeader, PhotoUploadField, SelectField, Spinner, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCurrentUser, useUpdateCurrentUser } from '../auth/currentUserQueries';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import { useI18n } from '../i18n/I18nProvider';
import { languageName } from '../i18n/format';

/**
 * The signed-in user's own profile (`/profile`, reached from the header's
 * account menu) — GET/PATCH /users/me, available to every portal user.
 *
 * Fields are the approved set, each one `UpdateUserDto` accepts: photo, first
 * name, surname, username, date of birth, language, currency and address.
 * `UpdateUserDto` also accepts gender, nationality and the Decision 220/246
 * measurements; they're left off on purpose (not in the approved design).
 * Email and phone are shown read-only — the DTO deliberately excludes both
 * (they're the login/OTP identifiers; see its own header comment).
 *
 * Blank username/language/currency/address are sent as `null` (clears them,
 * same convention as SchoolPage); date of birth and photo can't be cleared
 * (the API rejects a null date of birth, and the DTO has no null for the
 * photo), so a blank one is simply left out. The photo uses the same
 * `POST /uploads/public-photo-url` path as every other photo field, with
 * entityType USER and no entityId — the API's self-service case.
 *
 * Saving a new language switches the portal's text the same way the header's
 * picker does (`rememberLocale`, plus the saved profile language itself).
 */
export function MyProfilePage() {
  const { t, rememberLocale } = useI18n();
  const { data: me, isLoading, error: loadError } = useCurrentUser();
  const updateMe = useUpdateCurrentUser();
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();

  const [form, setForm] = useState<{
    profilePhotoUrl: string;
    firstName: string;
    surname: string;
    username: string;
    dateOfBirth: string;
    language: string;
    currency: string;
    address: string;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Filled once from the loaded profile — not re-synced on every refetch, so
  // a background refetch can't overwrite edits in progress.
  if (form === null && me) {
    setForm({
      profilePhotoUrl: me.profilePhotoUrl ?? '',
      firstName: me.firstName,
      surname: me.surname,
      username: me.username ?? '',
      dateOfBirth: me.dateOfBirth ? me.dateOfBirth.slice(0, 10) : '',
      language: me.language ?? '',
      currency: me.currency ?? '',
      address: me.address ?? '',
    });
  }

  function set<K extends keyof NonNullable<typeof form>>(key: K, value: NonNullable<typeof form>[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaveError(null);
    setSaved(false);
    try {
      await updateMe.mutateAsync({
        profilePhotoUrl: form.profilePhotoUrl || undefined,
        firstName: form.firstName,
        surname: form.surname,
        username: form.username || null,
        dateOfBirth: form.dateOfBirth || undefined,
        language: form.language || null,
        currency: form.currency || null,
        address: form.address || null,
      });
      if (form.language) rememberLocale(form.language);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  if (loadError) return <ErrorBanner message={loadError instanceof ApiError ? loadError.message : t('profile.loadFailed')} />;
  if (isLoading || !me || !form) return <Spinner />;

  return (
    <>
      <PageHeader title={t('profile.title')} subtitle={`${me.firstName} ${me.surname}`.trim()} />
      <Card>
        <form onSubmit={handleSubmit}>
          {saveError ? <ErrorBanner message={saveError} /> : null}
          {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
          <Field label={t('students.update.photo')} htmlFor="profile-photo">
            <PhotoUploadField
              value={form.profilePhotoUrl}
              onChange={(profilePhotoUrl) => set('profilePhotoUrl', profilePhotoUrl)}
              requestUpload={(file) =>
                requestPhotoUpload.mutateAsync({
                  entityType: 'USER',
                  contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
                })
              }
            />
          </Field>
          <Field label={t('students.update.firstName')} htmlFor="profile-firstName">
            <TextField required maxLength={100} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </Field>
          <Field label={t('students.update.surname')} htmlFor="profile-surname">
            <TextField required maxLength={100} value={form.surname} onChange={(e) => set('surname', e.target.value)} />
          </Field>
          <Field label={t('students.update.username')} htmlFor="profile-username">
            <TextField maxLength={50} value={form.username} onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field label={t('students.update.dateOfBirth')} htmlFor="profile-dob">
            <TextField type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </Field>
          <Field label={t('students.update.language')} htmlFor="profile-language">
            <SelectField
              value={form.language}
              onChange={(e) => set('language', e.target.value)}
              options={[{ value: '', label: t('schools.form.notSet') }, ...(languages ?? []).map((l) => ({ value: l.code, label: languageName(l.code, l.name) }))]}
            />
          </Field>
          <Field label={t('students.update.currency')} htmlFor="profile-currency">
            <CurrencyField
              id="profile-currency"
              value={form.currency}
              onChange={(code) => set('currency', code)}
              options={[{ code: '', name: t('schools.form.notSet') }, ...(currencies ?? [])]}
              placeholder={t('schools.form.notSet')}
            />
          </Field>
          <Field label={t('students.update.address')} htmlFor="profile-address">
            <TextField maxLength={500} value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label={t('auth.emailLabel')} htmlFor="profile-email">
            <TextField readOnly value={me.email} />
          </Field>
          <Field label={t('auth.phoneLabel')} htmlFor="profile-phone" hint={t('profile.signInNote')}>
            <TextField readOnly value={me.phone} />
          </Field>
          <div style={{ marginTop: 16 }}>
            <Button type="submit" loading={updateMe.isPending}>
              {t('schools.profile.saveChanges')}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
