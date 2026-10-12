import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ErrorBanner, Field, PageHeader, PhotoUploadField, Spinner, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import { useStudents, useUpdateStudentProfile } from './studentQueries';

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
  const { id } = useParams<{ id: string }>();
  const studentId = id ?? null;
  const schoolId = useGradingSchoolId();
  const navigate = useNavigate();
  const students = useStudents(schoolId);
  const updateProfile = useUpdateStudentProfile(schoolId);
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();

  const student = students.data?.items.find((s) => s.id === studentId);
  const studentName = student ? `${student.firstName} ${student.surname}`.trim() : 'Student';

  const [form, setForm] = useState<{
    firstName: string;
    surname: string;
    username: string;
    dateOfBirth: string;
    gender: string;
    nationality: string;
    language: string;
    currency: string;
    address: string;
    profilePhotoUrl: string;
  } | null>(null);
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
      address: '',
      profilePhotoUrl: '',
    });
  }

  if (!schoolId || !studentId) return null;
  if (students.isLoading) return <Spinner />;
  if (students.error) {
    return <ErrorBanner message={students.error instanceof ApiError ? students.error.message : 'Could not load this Student.'} />;
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
          address: safeForm.address || undefined,
          profilePhotoUrl: safeForm.profilePhotoUrl || undefined,
        },
      });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not update this profile. Please try again.');
    }
  }

  return (
    <>
      <PageHeader
        title={`Edit ${studentName}'s profile`}
        subtitle="On this Student's behalf — email and phone can't be changed here; they're this Student's login/OTP identifiers."
        actions={
          <Button variant="secondary" onClick={() => navigate(`/students/${studentId}`)}>
            Back to {studentName}
          </Button>
        }
      />
      {saved ? <SuccessBanner message="Profile saved." /> : null}
      {saveError ? <ErrorBanner message={saveError} /> : null}
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label="First name" htmlFor="student-update-firstName">
            <TextField
              required
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f!, firstName: e.target.value }))}
            />
          </Field>
          <Field label="Surname" htmlFor="student-update-surname">
            <TextField
              required
              value={form.surname}
              onChange={(e) => setForm((f) => ({ ...f!, surname: e.target.value }))}
            />
          </Field>
          <Field label="Username" htmlFor="student-update-username" hint="Mobile app only. Leave blank to keep unchanged.">
            <TextField value={form.username} onChange={(e) => setForm((f) => ({ ...f!, username: e.target.value }))} />
          </Field>
          <Field label="Date of birth" htmlFor="student-update-dob" hint="Leave blank to keep unchanged.">
            <TextField
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm((f) => ({ ...f!, dateOfBirth: e.target.value }))}
            />
          </Field>
          <Field label="Gender" htmlFor="student-update-gender" hint="Leave blank to keep unchanged.">
            <TextField value={form.gender} onChange={(e) => setForm((f) => ({ ...f!, gender: e.target.value }))} />
          </Field>
          <Field label="Nationality" htmlFor="student-update-nationality" hint="Leave blank to keep unchanged.">
            <TextField value={form.nationality} onChange={(e) => setForm((f) => ({ ...f!, nationality: e.target.value }))} />
          </Field>
          <Field label="Language" htmlFor="student-update-language" hint="Leave blank to keep unchanged.">
            <TextField value={form.language} onChange={(e) => setForm((f) => ({ ...f!, language: e.target.value }))} />
          </Field>
          <Field label="Currency" htmlFor="student-update-currency" hint="Leave blank to keep unchanged.">
            <TextField value={form.currency} onChange={(e) => setForm((f) => ({ ...f!, currency: e.target.value }))} />
          </Field>
          <Field label="Address" htmlFor="student-update-address" hint="Leave blank to keep unchanged.">
            <TextField value={form.address} onChange={(e) => setForm((f) => ({ ...f!, address: e.target.value }))} />
          </Field>
          <Field label="Photo" htmlFor="student-update-photo" hint="Leave unchanged to keep the existing photo.">
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
            Save
          </Button>
        </form>
      </Card>
    </>
  );
}
