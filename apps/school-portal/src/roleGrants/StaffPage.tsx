import React, { useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, PageHeader, PhoneField, SelectField, Spinner, SuccessBanner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useBranches } from '../branches/branchQueries';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { guessDefaultCountry } from '../lib/phoneCountry';
import {
  fetchInviteCandidate,
  fetchUserRoleGrants,
  useCreateStaffManually,
  useInviteStaff,
  useRevokeRoleGrant,
  type InviteCandidateResponse,
  type RoleGrantResponse,
} from './roleGrantQueries';
import { CoachInvitesSection } from './CoachInvitesSection';
import { AddStaffManuallyModal } from './AddStaffManuallyModal';

/**
 * Invite / revoke Instructor or Branch Staff — the one confirmed RoleGrant authority
 * case (Decision 80/81: School Owner/Manager granting INSTRUCTOR or BRANCH_STAFF
 * within their own School only). No UI here implies broader granting authority (no
 * option to grant School Owner/Manager, Franchise Owner, Student, or Guardian) because
 * apps/api rejects all of those from this endpoint.
 *
 * The invite target has no RoleGrant at this School yet, so there's no shared-grant
 * path to look them up by — the form finds them by an exact email or phone match
 * first (GET .../role-grants/invite-candidate, Decision 116: exact match only, never
 * a name search), shows who was found, and only then sends the actual invite.
 *
 * There's no "list my School's staff" endpoint (see roleGrantQueries.ts's header
 * comment) — the lookup section below still looks up one User.id at a time, matching
 * exactly what GET /users/{userId}/role-grants actually supports. That response now
 * resolves the target's name (userFirstName/userSurname, Decision 114) so the lookup
 * results are attributable, not just a table of raw grant rows.
 *
 * Decision 246 — "Add staff manually" closes the exact gap the "Find" step above
 * used to dead-end on: no fallback existed when no ULTM8 account was found for the
 * searched email/phone. Mirrors AddInstructorManuallyModal/InstructorsPage's own
 * flow exactly (real User + RoleGrant created immediately, temp passcode emailed,
 * forced change on first login) — minus a third profile-row concern, since "Staff"
 * is just a RoleGrant row (role: BRANCH_STAFF), not a separate profile table.
 */
export function StaffPage() {
  const schoolId = useOwnedSchoolId();
  const { data: branchData } = useBranches(schoolId);
  const inviteStaff = useInviteStaff();
  const revokeGrant = useRevokeRoleGrant();
  const createStaffManually = useCreateStaffManually(schoolId ?? '');

  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [candidate, setCandidate] = useState<InviteCandidateResponse | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [findLoading, setFindLoading] = useState(false);
  const [role, setRole] = useState<'INSTRUCTOR' | 'BRANCH_STAFF'>('INSTRUCTOR');
  const [branchId, setBranchId] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  // Non-blocking emailSent flag (same treatment AddInstructorManuallyModal/
  // CoachInvitePage already give it) for the "you've been granted this role"
  // notification RoleGrantsService.create() now sends.
  const [inviteNotice, setInviteNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const [addingManually, setAddingManually] = useState(false);
  // Same non-blocking emailSent treatment as inviteNotice above, for Decision
  // 244's own temp-passcode email.
  const [addManuallyNotice, setAddManuallyNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const [lookupUserId, setLookupUserId] = useState('');
  const [lookupResult, setLookupResult] = useState<RoleGrantResponse[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  if (!schoolId) return null;
  const branches = branchData?.items ?? [];
  // Branch Staff always need a branch. An Instructor needs one whenever the
  // School has branches; with none, the School itself is the branch
  // (Decisions 168, 169).
  const needsBranch = role === 'BRANCH_STAFF' || branches.length > 0;

  async function handleFind(e: React.FormEvent) {
    e.preventDefault();
    setFindError(null);
    setInviteNotice(null);
    if (!inviteEmail && !invitePhone) {
      setFindError('Enter an email or phone number to search.');
      return;
    }
    setFindLoading(true);
    try {
      const result = await fetchInviteCandidate(schoolId!, {
        email: inviteEmail || undefined,
        phone: invitePhone || undefined,
      });
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

  function resetInviteSearch() {
    setCandidate(null);
    setFindError(null);
    setInviteEmail('');
    setInvitePhone('');
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteNotice(null);
    if (needsBranch && !branchId) {
      setInviteError(role === 'BRANCH_STAFF' ? 'Select a Branch for Branch Staff.' : 'Select the Branch this Instructor belongs to.');
      return;
    }
    try {
      const granted = await inviteStaff.mutateAsync({
        targetUserId: candidate!.id!,
        body: { role, schoolId: schoolId!, branchId: needsBranch ? branchId : undefined },
      });
      setInviteNotice(
        granted.emailSent
          ? { kind: 'ok', text: 'Invited — they were emailed to let them know.' }
          : { kind: 'warn', text: 'Invited, but the notification email could not be sent.' },
      );
      resetInviteSearch();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setLookupError(null);
    setLookupLoading(true);
    try {
      const result = await fetchUserRoleGrants(lookupUserId);
      setLookupResult(result.items.filter((g) => g.schoolId === schoolId));
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Could not look up this user.');
      setLookupResult(null);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleRevoke(grant: RoleGrantResponse) {
    try {
      await revokeGrant.mutateAsync({ targetUserId: grant.userId, roleGrantId: grant.id });
      setLookupResult((rows) => rows?.map((g) => (g.id === grant.id ? { ...g, revokedAt: new Date().toISOString() } : g)) ?? null);
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Could not revoke this grant.');
    }
  }

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Invite Instructors and Branch Staff to your School."
        actions={
          <Button variant="secondary" onClick={() => setAddingManually(true)}>
            Add staff manually
          </Button>
        }
      />

      {addManuallyNotice?.kind === 'ok' ? <SuccessBanner message={addManuallyNotice.text} /> : null}
      {addManuallyNotice?.kind === 'warn' ? <ErrorBanner message={addManuallyNotice.text} /> : null}

      <Card className="ultm8-field">
        <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
          Invite staff
        </h2>
        <p className="ultm8-field">
          Invites an existing ULTM8 account to a role. No account found? Use "Add staff manually" above instead.
        </p>
        {inviteNotice?.kind === 'ok' ? <SuccessBanner message={inviteNotice.text} /> : null}
        {inviteNotice?.kind === 'warn' ? <ErrorBanner message={inviteNotice.text} /> : null}
        {!candidate ? (
          <form onSubmit={handleFind}>
            {findError ? <ErrorBanner message={findError} /> : null}
            <Field label="Email" htmlFor="invite-email" hint="Exact match only. Provide email or phone (or both).">
              <TextField type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </Field>
            <Field label="Phone" htmlFor="invite-phone" hint="Exact match only.">
              <PhoneField value={invitePhone} onChange={setInvitePhone} defaultCountry={guessDefaultCountry()} />
            </Field>
            <Button type="submit" loading={findLoading}>
              Find
            </Button>
          </form>
        ) : (
          <form onSubmit={handleInvite}>
            {inviteError ? <ErrorBanner message={inviteError} /> : null}
            <p className="ultm8-field">
              Found <strong>{candidate.firstName} {candidate.surname}</strong>.
            </p>
            <Field label="Role" htmlFor="invite-role">
              <SelectField
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                options={[
                  { value: 'INSTRUCTOR', label: 'Instructor' },
                  { value: 'BRANCH_STAFF', label: 'Branch Staff' },
                ]}
              />
            </Field>
            {needsBranch ? (
              <Field
                label="Branch"
                htmlFor="invite-branch"
                hint={role === 'INSTRUCTOR' ? 'For an instructor who teaches at several branches, invite them once per branch.' : undefined}
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
              <Button type="submit" loading={inviteStaff.isPending}>
                Send invite
              </Button>
              <Button type="button" variant="secondary" onClick={resetInviteSearch}>
                Search again
              </Button>
            </div>
          </form>
        )}
      </Card>

      <CoachInvitesSection schoolId={schoolId} />

      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
          Look up a user's grants
        </h2>
        <form onSubmit={handleLookup} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Field label="User ID" htmlFor="lookup-userId">
              <TextField required value={lookupUserId} onChange={(e) => setLookupUserId(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="secondary" loading={lookupLoading}>
            Look up
          </Button>
        </form>
        {lookupError ? <ErrorBanner message={lookupError} /> : null}
        {lookupLoading ? <Spinner /> : null}
        {lookupResult ? (
          lookupResult.length === 0 ? (
            <p>No grants at your School for this user.</p>
          ) : (
            <>
              <p className="ultm8-field">
                Showing grants for <strong>{lookupResult[0].userFirstName} {lookupResult[0].userSurname}</strong>.
              </p>
              <Table<RoleGrantResponse>
                rows={lookupResult}
                columns={[
                  { key: 'role', header: 'Role', render: (g) => <Badge variant="accent">{g.role}</Badge> },
                  { key: 'branch', header: 'Branch', render: (g) => g.branchId ?? '— (whole School)' },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (g) => (g.revokedAt ? <Badge>Revoked</Badge> : <Badge variant="success">Active</Badge>),
                  },
                  {
                    key: 'actions',
                    header: '',
                    render: (g) =>
                      g.revokedAt ? null : (
                        <Button variant="danger" onClick={() => handleRevoke(g)}>
                          Revoke
                        </Button>
                      ),
                  },
                ]}
              />
            </>
          )
        ) : null}
      </Card>

      {addingManually ? (
        <AddStaffManuallyModal
          branches={branches}
          submitting={createStaffManually.isPending}
          onSubmit={async (values) => {
            const created = await createStaffManually.mutateAsync(values);
            setAddManuallyNotice(
              created.emailSent
                ? { kind: 'ok', text: `${created.userFirstName} ${created.userSurname} was added — a temporary passcode was emailed to ${created.email}.` }
                : {
                    kind: 'warn',
                    text: `${created.userFirstName} ${created.userSurname} was added, but the email couldn't be sent. They'll need the temporary passcode another way.`,
                  },
            );
            setAddingManually(false);
          }}
          onClose={() => setAddingManually(false)}
        />
      ) : null}
    </>
  );
}
