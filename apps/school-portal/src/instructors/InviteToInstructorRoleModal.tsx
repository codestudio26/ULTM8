import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, PhoneField, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from '../branches/branchQueries';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { fetchInviteCandidate, type InviteCandidateResponse } from '../roleGrants/roleGrantQueries';

/**
 * "Invite to Instructor Role" — the gap `instructors.service.ts`'s own
 * "Add Manually" duplicate-email error already points at by name ('use
 * "Invite to Instructor Role" instead'). Deliberately separate from
 * AddInstructorManuallyModal: that one creates a brand-new User (and grants
 * the role) from just name+email in one step; this one is for a person who
 * already has a ULTM8 account (e.g. as a Student or Guardian) — it only
 * grants the INSTRUCTOR RoleGrant (POST /users/{userId}/role-grants, same
 * confirmed authority case StaffPage's own "Invite staff" form already
 * uses), reusing that exact lookup-then-confirm UX (GET
 * .../role-grants/invite-candidate, Decision 116: exact email/phone match
 * only, never a name search) so this doesn't reinvent it.
 *
 * Granting the role is deliberately NOT the same thing as creating the
 * Instructor profile (InstructorsService.create()'s own header comment:
 * "This module does NOT grant the RoleGrant itself... two distinct
 * concerns") — after this modal closes, the School Owner still uses "Add
 * instructor" (which now lists this person as an eligible candidate) to add
 * their profile, exactly like the pre-existing Staff-page-then-Instructors-
 * page two-step flow this is replacing with one instructor-scoped entry
 * point.
 */
export function InviteToInstructorRoleModal({
  schoolId,
  branches,
  submitting,
  onSubmit,
  onClose,
}: {
  schoolId: string;
  branches: BranchResponse[];
  submitting: boolean;
  onSubmit: (values: { targetUserId: string; branchId?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [candidate, setCandidate] = useState<InviteCandidateResponse | null>(null);
  const [branchId, setBranchId] = useState('');
  const [findLoading, setFindLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same rule RoleGrantsService.create() and StaffPage's own form already
  // enforce (Decisions 168/169): a branch is required once the School has any.
  const requiresBranch = branches.length > 0;

  async function handleFind(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email && !phone) {
      setError('Enter an email or phone number to search.');
      return;
    }
    setFindLoading(true);
    try {
      const result = await fetchInviteCandidate(schoolId, { email: email || undefined, phone: phone || undefined });
      if (!result.found) {
        setError('No ULTM8 account found with that email or phone.');
        setCandidate(null);
        return;
      }
      setCandidate(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not search for this person.');
      setCandidate(null);
    } finally {
      setFindLoading(false);
    }
  }

  function searchAgain() {
    setCandidate(null);
    setError(null);
    setEmail('');
    setPhone('');
    setBranchId('');
  }

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (requiresBranch && !branchId) {
      setError('Select the Branch this Instructor belongs to.');
      return;
    }
    try {
      await onSubmit({ targetUserId: candidate!.id!, ...(requiresBranch ? { branchId } : {}) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title="Invite to Instructor role" onClose={onClose}>
      {!candidate ? (
        <form onSubmit={handleFind}>
          {error ? <ErrorBanner message={error} /> : null}
          <p className="ultm8-field">Find an existing ULTM8 account to grant the Instructor role to.</p>
          <Field label="Email" htmlFor="invite-instructor-email" hint="Exact match only. Provide email or phone (or both).">
            <TextField type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="invite-instructor-phone" hint="Exact match only.">
            <PhoneField value={phone} onChange={setPhone} defaultCountry={guessDefaultCountry()} />
          </Field>
          <Button type="submit" loading={findLoading}>
            Find
          </Button>
        </form>
      ) : (
        <form onSubmit={handleGrant}>
          {error ? <ErrorBanner message={error} /> : null}
          <p className="ultm8-field">
            Found{' '}
            <strong>
              {candidate.firstName} {candidate.surname}
            </strong>{' '}
            ({candidate.email}).
          </p>
          {requiresBranch ? (
            <Field
              label="Branch"
              htmlFor="invite-instructor-branch"
              hint="For an instructor who teaches at several branches, invite them once per branch."
            >
              <SelectField
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                options={[{ value: '', label: 'Select a Branch…' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </Field>
          ) : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="submit" loading={submitting}>
              Grant Instructor role
            </Button>
            <Button type="button" variant="secondary" onClick={searchAgain}>
              Search again
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
