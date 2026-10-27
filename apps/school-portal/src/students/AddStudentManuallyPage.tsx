import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Card, ErrorBanner, Field, PageHeader, SelectField, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, useBranches } from '../branches/branchQueries';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useAddStudentManually } from './studentQueries';
import { useT } from '../i18n/I18nProvider';

type Form = { firstName: string; surname: string; email: string; dateOfBirth: string; branchId: string };
const EMPTY: Form = { firstName: '', surname: '', email: '', dateOfBirth: '', branchId: '' };

/**
 * Add manually (Decision 366, Students Q1) — the School owner adds an adult
 * who has no ULTM8 account yet. The API creates the account, enrols them and
 * emails a temporary passcode; the app asks them to choose their own on first
 * sign-in. A child joins through their Guardian's app instead, so a date of
 * birth under 18 is refused (by the API; this page only explains it).
 * Someone who already has an account is invited (InviteStudentPage).
 */
export function AddStudentManuallyPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const navigate = useNavigate();
  const { data: branchData } = useBranches(schoolId);
  const addStudent = useAddStudentManually(schoolId);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ name: string; email: string; temporaryPasscode: string | null } | null>(null);

  // Owner only, like the Students page (Decision 341).
  if (!schoolId) return <Navigate to="/" replace />;
  const branches = branchData?.items ?? [];
  const needsBranch = branches.some((b) => !b.archivedAt);
  const set = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.firstName.trim() || !form.surname.trim() || !form.email.trim() || !form.dateOfBirth) {
      setError(t('students.addManually.fillAll'));
      return;
    }
    if (needsBranch && !form.branchId) {
      setError(t('students.invite.selectBranch'));
      return;
    }
    try {
      const res = await addStudent.mutateAsync({
        firstName: form.firstName,
        surname: form.surname,
        email: form.email,
        dateOfBirth: form.dateOfBirth,
        branchId: needsBranch ? form.branchId : undefined,
      });
      setAdded({ name: `${res.firstName} ${res.surname}`.trim(), email: res.email, temporaryPasscode: res.emailSent ? null : (res.temporaryPasscode ?? null) });
      setForm(EMPTY);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <>
      <PageHeader title={t('students.addManually.title')} subtitle={t('students.addManually.subtitle')} />
      <Card className="ultm8-field">
        {added ? (
          <>
            <SuccessBanner message={t('students.addManually.added', { name: added.name })} />
            {added.temporaryPasscode ? (
              <>
                <p>{t('students.addManually.emailFailed', { email: added.email })}</p>
                <p data-testid="temporary-passcode" style={{ fontSize: 24, fontWeight: 600, letterSpacing: 4 }}>
                  {added.temporaryPasscode}
                </p>
                <p className="ultm8-field__hint">{t('students.addManually.passcodeOnce')}</p>
              </>
            ) : (
              <p>{t('students.addManually.emailSent', { email: added.email })}</p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button onClick={() => navigate('/students')}>{t('students.invite.backToStudents')}</Button>
              <Button variant="secondary" onClick={() => setAdded(null)}>
                {t('students.addManually.addAnother')}
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            {error ? <ErrorBanner message={error} /> : null}
            <Field label={t('students.update.firstName')} htmlFor="add-student-first-name">
              <TextField id="add-student-first-name" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
            </Field>
            <Field label={t('students.update.surname')} htmlFor="add-student-surname">
              <TextField id="add-student-surname" value={form.surname} onChange={(e) => set('surname', e.target.value)} />
            </Field>
            <Field label={t('students.invite.email')} htmlFor="add-student-email" hint={t('students.addManually.emailHint')}>
              <TextField id="add-student-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label={t('students.update.dateOfBirth')} htmlFor="add-student-dob" hint={t('students.addManually.adultsOnly')}>
              <TextField id="add-student-dob" type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
            </Field>
            {needsBranch ? (
              <Field label={t('students.invite.homeBranch')} htmlFor="add-student-branch">
                <SelectField
                  id="add-student-branch"
                  value={form.branchId}
                  onChange={(e) => set('branchId', e.target.value)}
                  options={[{ value: '', label: t('students.invite.branchPlaceholder') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
                />
              </Field>
            ) : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="submit" loading={addStudent.isPending}>
                {t('students.addManually.submit')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate('/students')}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
