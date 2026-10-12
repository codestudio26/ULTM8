import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorBanner, Field, PageHeader, PhoneField, SelectField, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useBranches } from '../branches/branchQueries';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { fetchInviteCandidate, type InviteCandidateResponse } from '../roleGrants/roleGrantQueries';
import { useInviteStudent } from './studentQueries';

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
 * Student", 28 Sep update) in favor of this narrower shape. See this PR's
 * own description for the open question that leaves: whether a from-scratch
 * "add a brand-new person" path (the Instructor page's own "Add manually",
 * mirrored) should still exist here too.
 */
export function InviteStudentPage() {
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

  if (!schoolId) return null;
  const branches = branchData?.items ?? [];
  const needsBranch = branches.length > 0;

  async function handleFind(e: React.FormEvent) {
    e.preventDefault();
    setFindError(null);
    setInviteSuccess(false);
    if (!email && !phone) {
      setFindError('Enter an email or phone number to search.');
      return;
    }
    setFindLoading(true);
    try {
      const result = await fetchInviteCandidate(schoolId!, { email: email || undefined, phone: phone || undefined });
      if (!result.found) {
        setFindError('No ULTM8 account found with that email or phone.');
        setCandidate(null);
        return;
      }
      setCandidate(result);
    } catch (err) {
      setFindError(err instanceof ApiError ? err.message : 'Could not search for this person.');
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
      setInviteError('Select this Student\'s home branch.');
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
      setInviteError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <>
      <PageHeader title="Invite a Student" subtitle="Enroll someone who already has a ULTM8 account at your School." />
      <Card className="ultm8-field">
        {inviteSuccess ? (
          <>
            <SuccessBanner message="Enrolled." />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button onClick={() => navigate('/students')}>Back to Students</Button>
              <Button variant="secondary" onClick={() => setInviteSuccess(false)}>
                Invite another
              </Button>
            </div>
          </>
        ) : !candidate ? (
          <form onSubmit={handleFind}>
            {findError ? <ErrorBanner message={findError} /> : null}
            <Field label="Email" htmlFor="invite-student-email" hint="Exact match only. Provide email or phone (or both).">
              <TextField type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Phone" htmlFor="invite-student-phone" hint="Exact match only.">
              <PhoneField value={phone} onChange={setPhone} defaultCountry={guessDefaultCountry()} />
            </Field>
            <Button type="submit" loading={findLoading}>
              Find
            </Button>
          </form>
        ) : (
          <form onSubmit={handleInvite}>
            {inviteError ? <ErrorBanner message={inviteError} /> : null}
            <p className="ultm8-field">
              Found <strong>{candidate.firstName} {candidate.surname}</strong> ({candidate.email}).
            </p>
            {needsBranch ? (
              <Field label="Home branch" htmlFor="invite-student-branch">
                {/* Not `required` — the browser's own HTML5 constraint validation would
                    silently swallow the submit before handleInvite's own branch check
                    (and its friendlier error message) ever ran. */}
                <SelectField
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  options={[{ value: '', label: 'Select a Branch…' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                />
              </Field>
            ) : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="submit" loading={inviteStudent.isPending}>
                Enroll
              </Button>
              <Button type="button" variant="secondary" onClick={resetSearch}>
                Search again
              </Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
