import React, { useState } from 'react';
import {
  AddressFields,
  Button,
  Card,
  CurrencyField,
  ErrorBanner,
  Field,
  PageHeader,
  PasscodeField,
  PhotoUploadField,
  SelectField,
  Spinner,
  SuccessBanner,
  TextField,
  hasLegacyAddressOnly,
  postalAddressFromRecord,
  preparePostalAddress,
  type PostalAddress,
  type PostalAddressErrors,
} from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useCurrentUser, useUpdateCurrentUser } from '../auth/currentUserQueries';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import { useI18n } from '../i18n/I18nProvider';
import { languageName } from '../i18n/format';
import { guessDefaultCountry } from '../lib/phoneCountry';

/**
 * The signed-in user's own profile (`/profile`, reached from the header's
 * account menu) — GET/PATCH /users/me, available to every portal user.
 *
 * Fields are the approved set, each one `UpdateUserDto` accepts: photo, first
 * name, surname, username, date of birth, language, currency and address.
 * "Remove photo" saves the photo as null (sign-in review A11).
 * `UpdateUserDto` also accepts gender, nationality and the Decision 220/246
 * measurements; they're left off on purpose (not in the approved design).
 * Email and phone are shown read-only — the DTO deliberately excludes both
 * (they're the login/OTP identifiers; see its own header comment).
 *
 * Blank username/language/currency are sent as `null` (clears them, same
 * convention as SchoolPage). The address is the shared country-first
 * `AddressFields` (Decision 276), sent as `postalAddress` only when it
 * changed, and `null` when emptied; date of birth can't be cleared (the API
 * rejects a null date of birth), so a blank one is simply left out. The photo uses the same
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
    address: PostalAddress;
  } | null>(null);
  const [initialAddress, setInitialAddress] = useState<PostalAddress | undefined>(undefined);
  const [addressErrors, setAddressErrors] = useState<PostalAddressErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Filled once from the loaded profile — not re-synced on every refetch, so
  // a background refetch can't overwrite edits in progress.
  if (form === null && me) {
    const address = postalAddressFromRecord(me, guessDefaultCountry());
    setInitialAddress(address);
    setForm({
      profilePhotoUrl: me.profilePhotoUrl ?? '',
      firstName: me.firstName,
      surname: me.surname,
      username: me.username ?? '',
      dateOfBirth: me.dateOfBirth ? me.dateOfBirth.slice(0, 10) : '',
      language: me.language ?? '',
      currency: me.currency ?? '',
      address,
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
    const prepared = preparePostalAddress(form.address, initialAddress);
    if (!prepared.ok) {
      setAddressErrors(prepared.errors);
      return;
    }
    setAddressErrors({});
    try {
      await updateMe.mutateAsync({
        // A removed photo is sent as null, which clears it (A11).
        profilePhotoUrl: form.profilePhotoUrl || (me?.profilePhotoUrl ? null : undefined),
        firstName: form.firstName,
        surname: form.surname,
        username: form.username || null,
        dateOfBirth: form.dateOfBirth || undefined,
        language: form.language || null,
        currency: form.currency || null,
        postalAddress: prepared.postalAddress,
      });
      setInitialAddress(form.address);
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
            {form.profilePhotoUrl ? (
              <div style={{ marginTop: 8 }}>
                <Button type="button" variant="secondary" onClick={() => set('profilePhotoUrl', '')}>
                  {t('profile.removePhoto')}
                </Button>
              </div>
            ) : null}
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
          <AddressFields
            idPrefix="profile-address"
            value={form.address}
            onChange={(address) => set('address', address)}
            errors={addressErrors}
            legacy={hasLegacyAddressOnly(me) && !form.address.country}
          />
          <Field label={t('auth.emailLabel')} htmlFor="profile-email">
            <TextField readOnly value={me.email} />
          </Field>
          <Field label={t('auth.phoneLabel')} htmlFor="profile-phone" hint={t('profile.signInNote')}>
            <TextField readOnly value={me.phone ?? ''} />
          </Field>
          <div style={{ marginTop: 16 }}>
            <Button type="submit" loading={updateMe.isPending}>
              {t('schools.profile.saveChanges')}
            </Button>
          </div>
        </form>
      </Card>
      <ChangePasscodeCard />
    </>
  );
}

/** "Change passcode" (Decision 375, Q1): the current passcode, then the new one
 * twice. The API signs out every other browser and phone and hands this one a
 * new token pair, which is swapped in so this page stays signed in. */
function ChangePasscodeCard() {
  const { t } = useI18n();
  const { replaceTokens } = useAuth();
  const [currentPasscode, setCurrentPasscode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setChanged(false);
    if (newPasscode !== confirmPasscode) {
      setError(t('auth.newPasscodeMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await unwrap(apiClient.POST('/v1/auth/passcode-change', { body: { currentPasscode, newPasscode } }));
      replaceTokens(result.accessToken!, result.refreshToken!);
      setCurrentPasscode('');
      setNewPasscode('');
      setConfirmPasscode('');
      setChanged(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>{t('profile.changePasscode.title')}</h2>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        {changed ? <SuccessBanner message={t('profile.changePasscode.changed')} /> : null}
        <Field label={t('profile.changePasscode.current')} htmlFor="profile-current-passcode">
          <PasscodeField
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="current-password"
            required
            value={currentPasscode}
            onChange={(e) => setCurrentPasscode(e.target.value)}
          />
        </Field>
        <Field label={t('auth.newPasscodeLabel')} htmlFor="profile-new-passcode" hint={t('profile.changePasscode.hint')}>
          <PasscodeField
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="new-password"
            required
            value={newPasscode}
            onChange={(e) => setNewPasscode(e.target.value)}
          />
        </Field>
        <Field label={t('auth.confirmNewPasscodeLabel')} htmlFor="profile-confirm-passcode">
          <PasscodeField
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="new-password"
            required
            value={confirmPasscode}
            onChange={(e) => setConfirmPasscode(e.target.value)}
          />
        </Field>
        <div style={{ marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            {t('profile.changePasscode.submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
