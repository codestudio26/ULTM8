import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AddressFields, Button, Card, CurrencyField, ErrorBanner, Field, PageHeader, PhotoUploadField, SelectField, Spinner, SuccessBanner, TextField, postalAddressFromRecord, preparePostalAddress, type PostalAddress, type PostalAddressErrors } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useStudentProfile, useUpdateStudentProfile, type StudentProfileResponse, type UpdateStudentProfileInput } from './studentQueries';
import { useT } from '../i18n/I18nProvider';
import { languageName } from '../i18n/format';

type Form = {
  firstName: string;
  surname: string;
  username: string;
  dateOfBirth: string;
  gender: string;
  nationality: string;
  language: string;
  currency: string;
  address: PostalAddress;
  profilePhotoUrl: string;
  weightCategory: string;
  kimonoSize: string;
  beltSize: string;
};

/** The fields that a blank clears (sent as `null`). */
const CLEARABLE = ['username', 'gender', 'nationality', 'language', 'currency', 'weightCategory', 'kimonoSize', 'beltSize'] as const;

function formFrom(p: StudentProfileResponse): Form {
  return {
    firstName: p.firstName,
    surname: p.surname,
    username: p.username ?? '',
    dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : '',
    gender: p.gender ?? '',
    nationality: p.nationality ?? '',
    language: p.language ?? '',
    currency: p.currency ?? '',
    address: postalAddressFromRecord(p, guessDefaultCountry()),
    profilePhotoUrl: p.profilePhotoUrl ?? '',
    weightCategory: p.weightCategory ?? '',
    kimonoSize: p.kimonoSize ?? '',
    beltSize: p.beltSize ?? '',
  };
}

/**
 * `StudentUpdate.dc.html` (v1.2 backend backlog — "Update Student page") — a
 * Staff member editing a Student's own profile on their behalf, reached from
 * the student page's "Edit profile" button (StudentGradingPage.tsx). A
 * dedicated page (`/students/:id/edit`), not a Modal, matching
 * BranchSettingsPage (Decision 231).
 *
 * Opens with the Student's current profile (GET
 * /schools/{id}/students/{studentId}/profile, Decision 341) and sends only
 * what changed, so a value saved before Language and Currency became lists
 * doesn't block saving something else. Emptying a field clears it; date of
 * birth and photo can't be cleared (the API keeps both). Language and
 * Currency are picked from the lists the app serves, as on My Profile.
 * Email and phone aren't here: they're the Student's login/OTP identifiers
 * (see UpdateUserDto's own header comment).
 */
export function StudentUpdatePage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const studentId = id ?? null;
  const schoolId = useGradingSchoolId();
  const navigate = useNavigate();
  const profile = useStudentProfile(schoolId, studentId);
  const updateProfile = useUpdateStudentProfile(schoolId);
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();

  const [initial, setInitial] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [addressErrors, setAddressErrors] = useState<PostalAddressErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Filled once from the loaded profile — not re-synced on every refetch, so
  // a background refetch can't overwrite edits in progress.
  if (form === null && profile.data) {
    const loaded = formFrom(profile.data);
    setInitial(loaded);
    setForm(loaded);
  }

  if (!schoolId || !studentId) return null;
  if (profile.isLoading) return <Spinner />;
  if (profile.error) {
    return <ErrorBanner message={profile.error instanceof ApiError ? profile.error.message : t('students.update.loadFailed')} />;
  }
  if (!profile.data || !form || !initial) return null;
  const studentName = `${profile.data.firstName} ${profile.data.surname}`.trim() || t('students.update.studentFallback');
  // Narrowed to stable, non-null locals for the closure below.
  const safeStudentId = studentId;
  const safeForm = form;
  const safeInitial = initial;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    const prepared = preparePostalAddress(safeForm.address, safeInitial.address);
    if (!prepared.ok) {
      setAddressErrors(prepared.errors);
      return;
    }
    setAddressErrors({});
    const body: UpdateStudentProfileInput = {};
    if (safeForm.firstName !== safeInitial.firstName) body.firstName = safeForm.firstName;
    if (safeForm.surname !== safeInitial.surname) body.surname = safeForm.surname;
    if (safeForm.dateOfBirth && safeForm.dateOfBirth !== safeInitial.dateOfBirth) body.dateOfBirth = safeForm.dateOfBirth;
    if (safeForm.profilePhotoUrl && safeForm.profilePhotoUrl !== safeInitial.profilePhotoUrl) body.profilePhotoUrl = safeForm.profilePhotoUrl;
    for (const key of CLEARABLE) {
      if (safeForm[key] !== safeInitial[key]) body[key] = safeForm[key].trim() || null;
    }
    if (prepared.postalAddress !== undefined) body.postalAddress = prepared.postalAddress;
    try {
      if (Object.keys(body).length > 0) {
        const updated = await updateProfile.mutateAsync({ studentId: safeStudentId, body });
        const reloaded = formFrom(updated);
        setInitial(reloaded);
        setForm(reloaded);
      }
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t('students.update.saveFailed'));
    }
  }

  return (
    <>
      <PageHeader
        title={t('students.update.title', { name: studentName })}
        subtitle={t('students.update.subtitle')}
        actions={
          <Button variant="secondary" onClick={() => navigate(`/students/${studentId}`)}>
            {t('students.update.backTo', { name: studentName })}
          </Button>
        }
      />
      {saved ? <SuccessBanner message={t('students.update.saved')} /> : null}
      {saveError ? <ErrorBanner message={saveError} /> : null}
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label={t('students.update.firstName')} htmlFor="student-update-firstName">
            <TextField
              required
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
            />
          </Field>
          <Field label={t('students.update.surname')} htmlFor="student-update-surname">
            <TextField
              required
              value={form.surname}
              onChange={(e) => set('surname', e.target.value)}
            />
          </Field>
          <Field label={t('students.update.username')} htmlFor="student-update-username" hint={t('auth.register.usernameHint')}>
            <TextField value={form.username} onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field label={t('students.update.dateOfBirth')} htmlFor="student-update-dob">
            <TextField type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </Field>
          <Field label={t('students.update.gender')} htmlFor="student-update-gender">
            <TextField value={form.gender} onChange={(e) => set('gender', e.target.value)} />
          </Field>
          <Field label={t('students.update.nationality')} htmlFor="student-update-nationality">
            <TextField value={form.nationality} onChange={(e) => set('nationality', e.target.value)} />
          </Field>
          <Field label={t('students.update.language')} htmlFor="student-update-language">
            <SelectField
              value={form.language}
              onChange={(e) => set('language', e.target.value)}
              options={[
                { value: '', label: t('schools.form.notSet') },
                // A value saved before the list existed stays shown until it's changed.
                ...(initial.language && !(languages ?? []).some((l) => l.code === initial.language) ? [{ value: initial.language, label: initial.language }] : []),
                ...(languages ?? []).map((l) => ({ value: l.code, label: languageName(l.code, l.name) })),
              ]}
            />
          </Field>
          <Field label={t('students.update.currency')} htmlFor="student-update-currency">
            <CurrencyField
              id="student-update-currency"
              value={form.currency}
              onChange={(code) => set('currency', code)}
              options={[
                { code: '', name: t('schools.form.notSet') },
                ...(initial.currency && !(currencies ?? []).some((c) => c.code === initial.currency) ? [{ code: initial.currency, name: initial.currency }] : []),
                ...(currencies ?? []),
              ]}
              placeholder={t('schools.form.notSet')}
            />
          </Field>
          <AddressFields
            idPrefix="student-update-address"
            value={form.address}
            onChange={(address) => set('address', address)}
            errors={addressErrors}
          />
          <Field label={t('students.update.weightCategory')} htmlFor="student-update-weight-category" hint={t('students.update.freeTextHint')}>
            <TextField value={form.weightCategory} onChange={(e) => set('weightCategory', e.target.value)} />
          </Field>
          <Field label={t('students.update.kimonoSize')} htmlFor="student-update-kimono-size" hint={t('students.update.freeTextHint')}>
            <TextField value={form.kimonoSize} onChange={(e) => set('kimonoSize', e.target.value)} />
          </Field>
          <Field label={t('students.update.beltSize')} htmlFor="student-update-belt-size" hint={t('students.update.freeTextHint')}>
            <TextField value={form.beltSize} onChange={(e) => set('beltSize', e.target.value)} />
          </Field>
          <Field label={t('students.update.photo')} htmlFor="student-update-photo" hint={t('students.update.photoHint')}>
            <PhotoUploadField
              value={form.profilePhotoUrl}
              onChange={(profilePhotoUrl) => set('profilePhotoUrl', profilePhotoUrl)}
              requestUpload={(file) =>
                requestPhotoUpload.mutateAsync({
                  entityType: 'USER',
                  schoolId,
                  entityId: safeStudentId,
                  contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
                })
              }
            />
          </Field>
          <Button type="submit" loading={updateProfile.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </Card>
    </>
  );
}
