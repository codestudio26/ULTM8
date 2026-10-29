import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Card, ErrorBanner, Field, PageHeader, SelectField, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, useBranches } from '../branches/branchQueries';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useAddStudentManually } from './studentQueries';
import { useAddChildManually } from './studentAccessQueries';
import { useT } from '../i18n/I18nProvider';

type Form = {
  firstName: string;
  surname: string;
  email: string;
  dateOfBirth: string;
  branchId: string;
  guardianFirstName: string;
  guardianSurname: string;
  guardianEmail: string;
};
const EMPTY: Form = { firstName: '', surname: '', email: '', dateOfBirth: '', branchId: '', guardianFirstName: '', guardianSurname: '', guardianEmail: '' };

/** Under 18 on the given day (the API decides; this only picks the form). */
function isChild(dateOfBirth: string, today = new Date()): boolean {
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return false;
  const eighteenth = new Date(Date.UTC(born.getUTCFullYear() + 18, born.getUTCMonth(), born.getUTCDate()));
  return eighteenth.getTime() > today.getTime();
}

type Added =
  | { kind: 'ADULT'; name: string; email: string; temporaryPasscode: string; emailSent: boolean }
  | { kind: 'GUARDIAN_CREATED'; child: string; guardian: string; email: string; temporaryPasscode: string; emailSent: boolean }
  | { kind: 'GUARDIAN_INVITED'; child: string; email: string; emailSent: boolean };

/**
 * Add manually (Decisions 371, 403): the School owner adds someone with no
 * ULTM8 account yet. An adult gets an account and a temporary passcode,
 * shown here once and emailed; it stops working after 7 days. A child has
 * no login of their own (Decision 175), so the owner names the Guardian: a
 * new Guardian gets the account and passcode, and the child is enrolled; a
 * Guardian who already has an account is asked to accept in the app.
 * Someone who already has an account is invited (InviteStudentPage).
 */
export function AddStudentManuallyPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const navigate = useNavigate();
  const { data: branchData } = useBranches(schoolId);
  const addStudent = useAddStudentManually(schoolId);
  const addChild = useAddChildManually(schoolId);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Added | null>(null);

  // Owner only, like the Students page (Decision 341).
  if (!schoolId) return <Navigate to="/" replace />;
  const branches = branchData?.items ?? [];
  const needsBranch = branches.some((b) => !b.archivedAt);
  const child = !!form.dateOfBirth && isChild(form.dateOfBirth);
  const set = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const missingChild = child && (!form.guardianFirstName.trim() || !form.guardianSurname.trim() || !form.guardianEmail.trim());
    if (!form.firstName.trim() || !form.surname.trim() || !form.dateOfBirth || (!child && !form.email.trim()) || missingChild) {
      setError(child ? t('students.addManually.fillAllChild') : t('students.addManually.fillAll'));
      return;
    }
    if (needsBranch && !form.branchId) {
      setError(t('students.invite.selectBranch'));
      return;
    }
    const branchId = needsBranch ? form.branchId : undefined;
    try {
      if (child) {
        const res = await addChild.mutateAsync({
          child: { firstName: form.firstName, surname: form.surname, dateOfBirth: form.dateOfBirth },
          guardian: { firstName: form.guardianFirstName, surname: form.guardianSurname, email: form.guardianEmail },
          branchId,
        });
        const childName = `${form.firstName.trim()} ${form.surname.trim()}`;
        setAdded(
          res.outcome === 'GUARDIAN_CREATED'
            ? {
                kind: 'GUARDIAN_CREATED',
                child: childName,
                guardian: `${form.guardianFirstName.trim()} ${form.guardianSurname.trim()}`,
                email: res.guardianEmail,
                temporaryPasscode: res.temporaryPasscode ?? '',
                emailSent: res.emailSent,
              }
            : { kind: 'GUARDIAN_INVITED', child: childName, email: res.guardianEmail, emailSent: res.emailSent },
        );
      } else {
        const res = await addStudent.mutateAsync({ firstName: form.firstName, surname: form.surname, email: form.email, dateOfBirth: form.dateOfBirth, branchId });
        setAdded({ kind: 'ADULT', name: `${res.firstName} ${res.surname}`.trim(), email: res.email, temporaryPasscode: res.temporaryPasscode, emailSent: res.emailSent });
      }
      setForm(EMPTY);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <>
      <PageHeader title={t('students.addManually.title')} subtitle={t('students.addManually.subtitleAll')} />
      <Card className="ultm8-field">
        {added ? (
          <>
            {added.kind === 'ADULT' ? <SuccessBanner message={t('students.addManually.added', { name: added.name })} /> : null}
            {added.kind === 'GUARDIAN_CREATED' ? <SuccessBanner message={t('students.addManually.childAdded', { child: added.child, guardian: added.guardian })} /> : null}
            {added.kind === 'GUARDIAN_INVITED' ? (
              <>
                <SuccessBanner message={t('students.addManually.guardianInvited', { email: added.email, child: added.child })} />
                {added.emailSent ? null : <p>{t('students.addManually.inviteNotEmailed')}</p>}
              </>
            ) : (
              <>
                <p>{added.kind === 'GUARDIAN_CREATED' ? t('students.addManually.passcodeGuardianShow', { name: added.guardian }) : t('students.addManually.passcodeShow')}</p>
                <p data-testid="temporary-passcode" style={{ fontSize: 24, fontWeight: 600, letterSpacing: 4 }}>
                  {added.temporaryPasscode}
                </p>
                <p className="ultm8-field__hint">{t('students.addManually.passcodeOnceDays')}</p>
                <p>{added.emailSent ? t('students.addManually.alsoEmailed', { email: added.email }) : t('students.addManually.notEmailed', { email: added.email })}</p>
              </>
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
            <Field label={t('students.update.dateOfBirth')} htmlFor="add-student-dob" hint={child ? t('students.addManually.childNote') : undefined}>
              <TextField id="add-student-dob" type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
            </Field>
            {child ? (
              <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
                <legend className="ultm8-field__label" style={{ fontSize: 15 }}>
                  {t('students.addManually.guardianHeading')}
                </legend>
                <Field label={t('students.update.firstName')} htmlFor="add-guardian-first-name">
                  <TextField id="add-guardian-first-name" value={form.guardianFirstName} onChange={(e) => set('guardianFirstName', e.target.value)} />
                </Field>
                <Field label={t('students.update.surname')} htmlFor="add-guardian-surname">
                  <TextField id="add-guardian-surname" value={form.guardianSurname} onChange={(e) => set('guardianSurname', e.target.value)} />
                </Field>
                <Field label={t('students.invite.email')} htmlFor="add-guardian-email" hint={t('students.addManually.guardianEmailHint')}>
                  <TextField id="add-guardian-email" type="email" value={form.guardianEmail} onChange={(e) => set('guardianEmail', e.target.value)} />
                </Field>
              </fieldset>
            ) : (
              <Field label={t('students.invite.email')} htmlFor="add-student-email" hint={t('students.addManually.emailHint')}>
                <TextField id="add-student-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
            )}
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
              <Button type="submit" loading={addStudent.isPending || addChild.isPending}>
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
