import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AddressFields, Button, Card, CurrencyField, ErrorBanner, Field, PageHeader, PhotoUploadField, SelectField, Spinner, SuccessBanner, TextField, postalAddressFromRecord, preparePostalAddress, type PostalAddress, type PostalAddressErrors } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import { useStudents, useUpdateStudentProfile } from './studentQueries';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { languageName } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';

/**
 * `StudentUpdate.dc.html` (v1.2 backend backlog — "Update Student page", a
 * proposed new capability until now) — a Staff member editing a Student's
 * own profile on their behalf, reached from `StudentDetail`'s own "Edit
 * Profile" button (StudentGradingPage.tsx, the real page that screen maps
 * to — see that mockup's own tooltip, quoted in the backlog doc).
 *
 * Built as a dedicated page/route (`/students/:id/edit`), not a Modal opened
 * from the Detail screen, because that's what the mockup itself is — a
 * separate `.dc.html` screen, not a dialog over `StudentDetail`. Mirrors
 * `BranchSettingsPage.tsx`'s own shape exactly (Decision 231: Branch's edit
 * form moved OUT of a Modal and INTO a dedicated page) rather than the
 * "Revoke enrollment" action+Modal already on StudentGradingPage.tsx:
 * Revoke is a single irreversible confirmation with no form, the same shape
 * ConfirmDeleteModal already serves everywhere else in this app, while this
 * is a multi-field edit form with its own named screen in the design canvas
 * — the Branch precedent is the one that actually matches this screen's
 * own shape, not just its "Staff-on-behalf-of" category.
 *
 * Fields match `UpdateStudentProfileDto`/`UpdateUserDto` exactly — no email/
 * phone field exists here at all (see that DTO's own header comment: both
 * are unique login/OTP identifiers, deliberately excluded from self-service
 * too). Known-data limitation, disclosed rather than hidden: unlike
 * BranchSettingsPage (which pre-fills every field from a real
 * `GET /branches/{id}`), there is no single-Student detail endpoint —
 * `StudentSummaryResponseDto` (the only Student read in this app,
 * `useStudents`) carries only `firstName`/`surname`/`email`/`enrolledAt`/
 * `status`. Only `firstName`/`surname` are pre-filled here; every other
 * field starts blank and is sent ONLY if the Staff member types a value — a
 * value left blank is omitted from the request entirely (never sent as an
 * empty string), so saving without touching it can't blank out something
 * the Student already has, but this form also can't be used to CLEAR an
 * existing value in one of those other fields today. Fixing that for real
 * needs a new Staff-facing "read one Student's full profile" endpoint, out
 * of this change's scope — flagged in the PR description, not silently
 * assumed away.
 */
export function StudentUpdatePage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const studentId = id ?? null;
  const schoolId = useGradingSchoolId();
  const navigate = useNavigate();
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();
  const students = useStudents(schoolId);
  const updateProfile = useUpdateStudentProfile(schoolId);
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();

  const student = students.data?.items.find((s) => s.id === studentId);
  const studentName = student ? `${student.firstName} ${student.surname}`.trim() : t('students.update.studentFallback');

  const [form, setForm] = useState<{
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
  } | null>(null);
  // This roster row doesn't carry the Student's current address, so the form
  // starts blank and only a filled-in address is sent (blank = keep unchanged).
  const [initialAddress] = useState(() => postalAddressFromRecord(null, guessDefaultCountry()));
  const [addressErrors, setAddressErrors] = useState<PostalAddressErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Pre-fill once the roster loads (same "fetch, then edit" shape
  // BranchSettingsPage uses, minus a real single-resource GET to re-sync
  // from — see this file's own header comment) — initialized lazily rather
  // than in a useEffect, since there's nothing to re-sync TO after a save
  // here (updateProfile's response isn't re-read back into the form).
  if (form === null && student) {
    setForm({
      firstName: student.firstName,
      surname: student.surname,
      username: '',
      dateOfBirth: '',
      gender: '',
      nationality: '',
      language: '',
      currency: '',
      address: initialAddress,
      profilePhotoUrl: '',
      weightCategory: '',
      kimonoSize: '',
      beltSize: '',
    });
  }

  if (!schoolId || !studentId) return null;
  if (students.isLoading) return <Spinner />;
  if (students.error) {
    return <ErrorBanner message={students.error instanceof ApiError ? students.error.message : t('students.update.loadFailed')} />;
  }
  if (!student || !form) return null;
  // Narrowed to a stable, non-null local — a nested function declared after an
  // early-return guard doesn't itself get TypeScript's narrowing of a mutable
  // (useState/useParams) value, since the compiler can't assume the guard
  // still holds whenever that closure actually runs.
  const safeStudentId = studentId;
  const safeForm = form;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    const prepared = preparePostalAddress(safeForm.address, initialAddress);
    if (!prepared.ok) {
      setAddressErrors(prepared.errors);
      return;
    }
    setAddressErrors({});
    try {
      await updateProfile.mutateAsync({
        studentId: safeStudentId,
        body: {
          firstName: safeForm.firstName,
          surname: safeForm.surname,
          username: safeForm.username || undefined,
          dateOfBirth: safeForm.dateOfBirth || undefined,
          gender: safeForm.gender || undefined,
          nationality: safeForm.nationality || undefined,
          language: safeForm.language || undefined,
          currency: safeForm.currency || undefined,
          postalAddress: prepared.postalAddress ?? undefined,
          profilePhotoUrl: safeForm.profilePhotoUrl || undefined,
          weightCategory: safeForm.weightCategory || undefined,
          kimonoSize: safeForm.kimonoSize || undefined,
          beltSize: safeForm.beltSize || undefined,
        },
      });
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
              onChange={(e) => setForm((f) => ({ ...f!, firstName: e.target.value }))}
            />
          </Field>
          <Field label={t('students.update.surname')} htmlFor="student-update-surname">
            <TextField
              required
              value={form.surname}
              onChange={(e) => setForm((f) => ({ ...f!, surname: e.target.value }))}
            />
          </Field>
          <Field label={t('students.update.username')} htmlFor="student-update-username" hint={t('students.update.usernameHint')}>
            <TextField value={form.username} onChange={(e) => setForm((f) => ({ ...f!, username: e.target.value }))} />
          </Field>
          <Field label={t('students.update.dateOfBirth')} htmlFor="student-update-dob" hint={t('students.update.keepHint')}>
            <TextField
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm((f) => ({ ...f!, dateOfBirth: e.target.value }))}
            />
          </Field>
          <Field label={t('students.update.gender')} htmlFor="student-update-gender" hint={t('students.update.keepHint')}>
            <TextField value={form.gender} onChange={(e) => setForm((f) => ({ ...f!, gender: e.target.value }))} />
          </Field>
          <Field label={t('students.update.nationality')} htmlFor="student-update-nationality" hint={t('students.update.keepHint')}>
            <TextField value={form.nationality} onChange={(e) => setForm((f) => ({ ...f!, nationality: e.target.value }))} />
          </Field>
          <Field label={t('students.update.language')} htmlFor="student-update-language" hint={t('students.update.keepHint')}>
            <SelectField
              value={form.language}
              onChange={(e) => setForm((f) => ({ ...f!, language: e.target.value }))}
              options={[{ value: '', label: t('common.none') }, ...(languages ?? []).map((l) => ({ value: l.code, label: languageName(l.code, l.name) }))]}
            />
          </Field>
          <Field label={t('students.update.currency')} htmlFor="student-update-currency" hint={t('students.update.keepHint')}>
            <CurrencyField
              id="student-update-currency"
              value={form.currency}
              onChange={(code) => setForm((f) => ({ ...f!, currency: code }))}
              options={[{ code: '', name: t('common.none') }, ...(currencies ?? [])]}
            />
          </Field>
          <AddressFields
            idPrefix="student-update-address"
            value={form.address}
            onChange={(address) => setForm((f) => ({ ...f!, address }))}
            errors={addressErrors}
            hint={t('students.update.keepHint')}
          />
          <Field label={t('students.update.weightCategory')} htmlFor="student-update-weight-category" hint={t('students.update.weightCategoryHint')}>
            <TextField value={form.weightCategory} onChange={(e) => setForm((f) => ({ ...f!, weightCategory: e.target.value }))} />
          </Field>
          <Field label={t('students.update.kimonoSize')} htmlFor="student-update-kimono-size" hint={t('students.update.kimonoSizeHint')}>
            <TextField value={form.kimonoSize} onChange={(e) => setForm((f) => ({ ...f!, kimonoSize: e.target.value }))} />
          </Field>
          <Field label={t('students.update.beltSize')} htmlFor="student-update-belt-size" hint={t('students.update.beltSizeHint')}>
            <TextField value={form.beltSize} onChange={(e) => setForm((f) => ({ ...f!, beltSize: e.target.value }))} />
          </Field>
          <Field label={t('students.update.photo')} htmlFor="student-update-photo" hint={t('students.update.photoHint')}>
            <PhotoUploadField
              value={form.profilePhotoUrl}
              onChange={(profilePhotoUrl) => setForm((f) => ({ ...f!, profilePhotoUrl }))}
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
