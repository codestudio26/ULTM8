import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, ErrorBanner, Field, PhoneField, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, useBranches } from '../branches/branchQueries';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { fetchInviteCandidate, type InviteCandidateResponse } from '../roleGrants/roleGrantQueries';
import { useInviteStudent } from './studentQueries';
import { Trans } from '../i18n/Trans';
import { useT } from '../i18n/I18nProvider';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import { Chapter } from './StudentFormParts';
import './studentForms.css';

/**
 * Invite a Student (v1.2 backend backlog) — a Staff member enrolling an
 * existing-but-unenrolled person at their own School. Follows the same
 * find-then-confirm pattern StaffPage's Instructor/Branch Staff invite flow
 * already established (same `GET .../role-grants/invite-candidate` lookup,
 * Decision 116 — exact email/phone match only, never a name search): the
 * invite target has no RoleGrant at this School yet, so there's nothing to
 * look them up by otherwise.
 *
 * Deliberately scoped to someone who ALREADY has a ULTM8 account — the
 * earlier "Enroll a Student" mockup's from-scratch account-creation form was
 * removed per direct product feedback (v1.2 backend backlog, "Invite a
 * Student", 28 Sep update) in favor of this narrower shape. A brand-new
 * adult is added from scratch on the owner's Add manually page instead
 * (AddStudentManuallyPage, Decision 371).
 */
export function InviteStudentPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const navigate = useNavigate();
  const { data: branchData } = useBranches(schoolId);
  const inviteStudent = useInviteStudent();

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [candidate, setCandidate] = useState<InviteCandidateResponse | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [findLoading, setFindLoading] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  // Owner only, like the Students page (Decision 341).
  if (!schoolId) return <Navigate to="/" replace />;
  const branches = branchData?.items ?? [];
  // Archived branches can't be chosen, so only open ones make a home branch
  // required (Decision 341), matching the API.
  const needsBranch = branches.some((b) => !b.archivedAt);

  async function handleFind(e: React.FormEvent) {
    e.preventDefault();
    setFindError(null);
    setInviteSuccess(false);
    if (!email && !phone) {
      setFindError(t('students.invite.enterEmailOrPhone'));
      return;
    }
    setFindLoading(true);
    try {
      const result = await fetchInviteCandidate(schoolId!, { email: email || undefined, phone: phone || undefined });
      if (!result.found) {
        setFindError(t('students.invite.notFound'));
        setCandidate(null);
        return;
      }
      setCandidate(result);
    } catch (err) {
      setFindError(err instanceof ApiError ? err.message : t('students.invite.searchFailed'));
      setCandidate(null);
    } finally {
      setFindLoading(false);
    }
  }

  function resetSearch() {
    setCandidate(null);
    setFindError(null);
    setEmail('');
    setPhone('');
    setBranchId('');
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(false);
    if (needsBranch && !branchId) {
      setInviteError(t('students.invite.selectBranch'));
      return;
    }
    try {
      await inviteStudent.mutateAsync({
        schoolId: schoolId!,
        body: { studentId: candidate!.id!, branchId: needsBranch ? branchId : undefined },
      });
      setInviteSuccess(true);
      resetSearch();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  // Form pattern "F" (DESIGN.md): one chapter, find the account, then
  // enrol them.
  return (
    <>
      <NewLookPageHeader parent={{ to: '/students', label: t('layout.nav.students') }} title={t('students.invite.title')} subtitle={t('students.invite.subtitle')} />
      <NewLookPage>
        {inviteSuccess ? (
          <section className="u8f-sheet u8f-result">
            <SuccessBanner message={t('students.invite.enrolled')} />
            <div className="u8f-pair">
              <Button onClick={() => navigate('/students')}>{t('students.invite.backToStudents')}</Button>
              <Button variant="secondary" onClick={() => setInviteSuccess(false)}>
                {t('students.invite.inviteAnother')}
              </Button>
            </div>
          </section>
        ) : !candidate ? (
          <form className="u8f-sheet" onSubmit={handleFind}>
            {findError ? <ErrorBanner message={findError} /> : null}
            <Chapter number={1} title={t('students.form.findAccount')}>
              <Field label={t('students.invite.email')} htmlFor="invite-student-email" hint={t('students.invite.emailHint')}>
                <TextField type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label={t('students.invite.phone')} htmlFor="invite-student-phone" hint={t('students.invite.phoneHint')}>
                <PhoneField value={phone} onChange={setPhone} defaultCountry={guessDefaultCountry()} />
              </Field>
              <div className="u8f-wide u8f-row-actions">
                <Button type="submit" loading={findLoading}>
                  {t('students.invite.find')}
                </Button>
              </div>
            </Chapter>
          </form>
        ) : (
          <form className="u8f-sheet" onSubmit={handleInvite}>
            {inviteError ? <ErrorBanner message={inviteError} /> : null}
            <Chapter number={1} title={t('students.form.findAccount')} done doneLabel={t('common.done')}>
              <p className="u8f-wide u8f-found">
                <Trans
                  k="students.invite.found"
                  vars={{ email: candidate.email ?? '' }}
                  nodes={{
                    name: (
                      <strong>
                        {candidate.firstName} {candidate.surname}
                      </strong>
                    ),
                  }}
                />
              </p>
              {needsBranch ? (
                <div className="u8n-dd-field u8f-wide">
                  {/* No browser `required` check: handleInvite's own branch
                      check (and its friendlier message) decides. */}
                  <NewLookSelect
                    id="invite-student-branch"
                    label={t('students.invite.homeBranch')}
                    value={branchId}
                    onChange={setBranchId}
                    options={[{ value: '', label: t('students.invite.branchPlaceholder') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
                  />
                </div>
              ) : null}
              <div className="u8f-wide u8f-pair">
                <Button type="submit" loading={inviteStudent.isPending}>
                  {t('students.invite.enroll')}
                </Button>
                <Button type="button" variant="secondary" onClick={resetSearch}>
                  {t('students.invite.searchAgain')}
                </Button>
              </div>
            </Chapter>
          </form>
        )}
      </NewLookPage>
    </>
  );
}
