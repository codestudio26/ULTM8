import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Checkbox, ErrorBanner, Field, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, useBranches } from '../branches/branchQueries';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useAddStudentManually } from './studentQueries';
import { useAddChildManually } from './studentAccessQueries';
import { useT } from '../i18n/I18nProvider';
import { dayFromToday } from '../membershipPlans/freezeQueries';
import { MemberContactFields, type MemberContacts } from './MemberDetails';
import { useSchool } from '../schools/schoolQueries';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import { formatDayOnly } from './LogAttendanceModal';
import { Chapter, initialsOf } from './StudentFormParts';
import './studentForms.css';

type Form = MemberContacts & {
  joinedOn: string;
  firstName: string;
  surname: string;
  email: string;
  dateOfBirth: string;
  branchId: string;
  guardianFirstName: string;
  guardianSurname: string;
  guardianEmail: string;
  /** Decision 434 (TXT-8): "Has only one name" — the surname is sent empty. */
  oneName: boolean;
  guardianOneName: boolean;
};
const NO_CONTACTS: MemberContacts = { secondaryPhone: '', secondaryEmail: '', emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '' };
/** A new form; the join date starts as today (Decision 315 item 4). */
const emptyForm = (): Form => ({
  firstName: '',
  surname: '',
  email: '',
  dateOfBirth: '',
  branchId: '',
  guardianFirstName: '',
  guardianSurname: '',
  guardianEmail: '',
  oneName: false,
  guardianOneName: false,
  joinedOn: dayFromToday(0),
  ...NO_CONTACTS,
});

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
 * The join date starts as today and can be set earlier, never later
 * (Decision 315 item 4); an adult's secondary phone and email and emergency
 * contact can be added here too (item 5).
 */
export function AddStudentManuallyPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const navigate = useNavigate();
  const { data: branchData } = useBranches(schoolId);
  const school = useSchool(schoolId);
  const addStudent = useAddStudentManually(schoolId);
  const addChild = useAddChildManually(schoolId);
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Added | null>(null);

  // Owner only, like the Students page (Decision 341).
  if (!schoolId) return <Navigate to="/" replace />;
  const branches = branchData?.items ?? [];
  const needsBranch = branches.some((b) => !b.archivedAt);
  const child = !!form.dateOfBirth && isChild(form.dateOfBirth);
  const set = (key: Exclude<keyof Form, 'oneName' | 'guardianOneName'>, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const tick = (key: 'oneName' | 'guardianOneName', value: boolean) => setForm((f) => ({ ...f, [key]: value }));
  /** The surname as sent: empty, with the tick, for someone with only one name (Decision 434, TXT-8). */
  const surnameOf = (surname: string, oneName: boolean) => (oneName ? { surname: '', hasOnlyOneName: true as const } : { surname });
  const fullName = (first: string, surname: string, oneName: boolean) => [first.trim(), oneName ? '' : surname.trim()].filter(Boolean).join(' ');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const missingChild = child && (!form.guardianFirstName.trim() || (!form.guardianOneName && !form.guardianSurname.trim()) || !form.guardianEmail.trim());
    if (!form.firstName.trim() || (!form.oneName && !form.surname.trim()) || !form.dateOfBirth || (!child && !form.email.trim()) || missingChild) {
      setError(child ? t('students.addManually.fillAllChild') : t('students.addManually.fillAll'));
      return;
    }
    if (needsBranch && !form.branchId) {
      setError(t('students.invite.selectBranch'));
      return;
    }
    if (form.joinedOn && form.joinedOn > dayFromToday(0)) {
      setError(t('students.addManually.joinedOnFuture'));
      return;
    }
    const branchId = needsBranch ? form.branchId : undefined;
    // Decision 315 item 4: blank means today.
    const joinedOn = form.joinedOn || undefined;
    try {
      if (child) {
        const res = await addChild.mutateAsync({
          child: { firstName: form.firstName, ...surnameOf(form.surname, form.oneName), dateOfBirth: form.dateOfBirth },
          guardian: { firstName: form.guardianFirstName, ...surnameOf(form.guardianSurname, form.guardianOneName), email: form.guardianEmail },
          branchId,
          joinedOn,
        });
        const childName = fullName(form.firstName, form.surname, form.oneName);
        setAdded(
          res.outcome === 'GUARDIAN_CREATED'
            ? {
                kind: 'GUARDIAN_CREATED',
                child: childName,
                guardian: fullName(form.guardianFirstName, form.guardianSurname, form.guardianOneName),
                email: res.guardianEmail,
                temporaryPasscode: res.temporaryPasscode ?? '',
                emailSent: res.emailSent,
              }
            : { kind: 'GUARDIAN_INVITED', child: childName, email: res.guardianEmail, emailSent: res.emailSent },
        );
      } else {
        // Decision 315 item 5: only the contacts typed in (a blank is none).
        const contacts: Partial<MemberContacts> = {};
        for (const key of Object.keys(NO_CONTACTS) as Array<keyof MemberContacts>) {
          if (form[key].trim()) contacts[key] = form[key].trim();
        }
        const res = await addStudent.mutateAsync({ firstName: form.firstName, ...surnameOf(form.surname, form.oneName), email: form.email, dateOfBirth: form.dateOfBirth, branchId, joinedOn, ...contacts });
        setAdded({ kind: 'ADULT', name: [res.firstName, res.surname].filter(Boolean).join(' '), email: res.email, temporaryPasscode: res.temporaryPasscode, emailSent: res.emailSent });
      }
      setForm(emptyForm());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  // Form pattern "F" (DESIGN.md; the approved "Add student" design): the
  // form as numbered chapters on the left, and on the right the preview card,
  // "Ready to save" (only what saving needs) and the Add / Cancel buttons.
  const name = fullName(form.firstName, form.surname, form.oneName);
  const nameDone = !!form.firstName.trim() && (form.oneName || !!form.surname.trim());
  const guardianDone = !!form.guardianFirstName.trim() && (form.guardianOneName || !!form.guardianSurname.trim()) && !!form.guardianEmail.trim();
  const checks: Array<{ label: string; done: boolean }> = [
    { label: t('students.form.name'), done: nameDone },
    { label: t('students.update.dateOfBirth'), done: !!form.dateOfBirth },
    child ? { label: t('students.addManually.guardianHeading'), done: guardianDone } : { label: t('students.invite.email'), done: !!form.email.trim() },
    ...(needsBranch ? [{ label: t('students.invite.homeBranch'), done: !!form.branchId }] : []),
  ];
  const personalDone = nameDone && !!form.dateOfBirth && (child || !!form.email.trim()) && (!needsBranch || !!form.branchId);
  const pending = addStudent.isPending || addChild.isPending;

  const header = <NewLookPageHeader parent={{ to: '/students', label: t('layout.nav.students') }} title={t('students.addManually.title')} subtitle={t('students.addManually.subtitleAll')} />;

  if (added) {
    return (
      <>
        {header}
        <NewLookPage>
          <section className="u8f-sheet u8f-result">
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
                <p data-testid="temporary-passcode" className="u8f-passcode">
                  {added.temporaryPasscode}
                </p>
                <p className="ultm8-field__hint">{t('students.addManually.passcodeOnceDays')}</p>
                <p>{added.emailSent ? t('students.addManually.alsoEmailed', { email: added.email }) : t('students.addManually.notEmailed', { email: added.email })}</p>
              </>
            )}
            <div className="u8f-pair">
              <Button onClick={() => navigate('/students')}>{t('students.invite.backToStudents')}</Button>
              <Button variant="secondary" onClick={() => setAdded(null)}>
                {t('students.addManually.addAnother')}
              </Button>
            </div>
          </section>
        </NewLookPage>
      </>
    );
  }

  const preview = (
    <div className="ultm8-form-preview">
      <div className="ultm8-preview-card">
        <div className="ultm8-preview-card__muted u8f-preview__top">
          <span>{school.data?.name ?? ''}</span>
          <span>{t('students.update.studentFallback')}</span>
        </div>
        <div className="u8f-preview__who">
          <span className="u8f-preview__avatar" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="u8f-preview__text">
            <div className={'u8f-preview__name' + (name ? '' : ' ultm8-preview-card__muted')}>{name || t('students.form.newStudent')}</div>
            <div className="ultm8-preview-card__muted u8f-preview__sub">{form.dateOfBirth ? t('students.form.born', { date: formatDayOnly(form.dateOfBirth) }) : t('students.form.previewHint')}</div>
          </div>
        </div>
      </div>
      <div className="u8f-ready">
        <p className="u8f-ready__title">{t('students.form.readyToSave')}</p>
        <ul className="ultm8-checklist">
          {checks.map((c) => (
            <li key={c.label} className={'ultm8-checklist__item' + (c.done ? ' ultm8-checklist__item--done' : '')}>
              {c.label}
            </li>
          ))}
        </ul>
        <div className="u8f-pair">
          <Button type="submit" form="add-student-form" loading={pending}>
            {t('students.addManually.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/students')}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {header}
      <NewLookPage inspector={preview} inspectorLabel={t('students.form.newStudent')}>
        <form id="add-student-form" className="u8f-sheet" onSubmit={handleSubmit} noValidate>
          {error ? <ErrorBanner message={error} /> : null}
          <Chapter number={1} title={t('students.form.personal')} description={t('students.form.personalHint')} done={personalDone} doneLabel={t('common.done')}>
            <Field label={t('students.update.firstName')} htmlFor="add-student-first-name">
              <TextField id="add-student-first-name" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
            </Field>
            <Field label={t('students.update.surname')} htmlFor="add-student-surname">
              <TextField id="add-student-surname" value={form.oneName ? '' : form.surname} disabled={form.oneName} onChange={(e) => set('surname', e.target.value)} />
            </Field>
            <div className="u8f-wide">
              <Checkbox label={t('students.update.hasOnlyOneName')} checked={form.oneName} onChange={(e) => tick('oneName', e.target.checked)} />
            </div>
            <Field label={t('students.update.dateOfBirth')} htmlFor="add-student-dob">
              <TextField id="add-student-dob" type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
            </Field>
            <Field label={t('students.update.joinedOn')} htmlFor="add-student-joined-on" hint={t('students.addManually.joinedOnHint')}>
              <TextField id="add-student-joined-on" type="date" max={dayFromToday(0)} value={form.joinedOn} onChange={(e) => set('joinedOn', e.target.value)} />
            </Field>
            {child ? null : (
              <Field label={t('students.invite.email')} htmlFor="add-student-email" hint={t('students.addManually.emailHint')}>
                <TextField id="add-student-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
            )}
            {needsBranch ? (
              <div className="u8n-dd-field">
                <NewLookSelect
                  id="add-student-branch"
                  label={t('students.invite.homeBranch')}
                  value={form.branchId}
                  onChange={(v) => set('branchId', v)}
                  options={[{ value: '', label: t('students.invite.branchPlaceholder') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
                />
              </div>
            ) : null}
            {/* Decision 315 item 5: an adult's other contacts. A child's are
                added on their page once enrolled. */}
            {child ? null : <MemberContactFields idPrefix="add-student" value={form} onChange={(key, value) => set(key, value)} collapsed />}
          </Chapter>
          {child ? (
            <Chapter number={2} title={t('students.addManually.guardianHeading')} description={t('students.addManually.childNote')} done={guardianDone} doneLabel={t('common.done')}>
              <Field label={t('students.update.firstName')} htmlFor="add-guardian-first-name">
                <TextField id="add-guardian-first-name" value={form.guardianFirstName} onChange={(e) => set('guardianFirstName', e.target.value)} />
              </Field>
              <Field label={t('students.update.surname')} htmlFor="add-guardian-surname">
                <TextField id="add-guardian-surname" value={form.guardianOneName ? '' : form.guardianSurname} disabled={form.guardianOneName} onChange={(e) => set('guardianSurname', e.target.value)} />
              </Field>
              <div className="u8f-wide">
                <Checkbox label={t('students.update.hasOnlyOneName')} checked={form.guardianOneName} onChange={(e) => tick('guardianOneName', e.target.checked)} />
              </div>
              <div className="u8f-wide">
                <Field label={t('students.invite.email')} htmlFor="add-guardian-email" hint={t('students.addManually.guardianEmailHint')}>
                  <TextField id="add-guardian-email" type="email" value={form.guardianEmail} onChange={(e) => set('guardianEmail', e.target.value)} />
                </Field>
              </div>
            </Chapter>
          ) : null}
        </form>
      </NewLookPage>
    </>
  );
}
