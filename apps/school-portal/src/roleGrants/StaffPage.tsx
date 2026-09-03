import React, { useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useBranches } from '../branches/branchQueries';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { fetchUserRoleGrants, useInviteStaff, useRevokeRoleGrant, type RoleGrantResponse } from './roleGrantQueries';

/**
 * Invite / revoke Instructor or Branch Staff — the one confirmed RoleGrant authority
 * case (Decision 80/81: School Owner/Manager granting INSTRUCTOR or BRANCH_STAFF
 * within their own School only). No UI here implies broader granting authority (no
 * option to grant School Owner/Manager, Franchise Owner, Student, or Guardian) because
 * apps/api rejects all of those from this endpoint.
 *
 * There's no "list my School's staff" endpoint (see roleGrantQueries.ts's header
 * comment) — this looks up one User.id at a time, matching exactly what
 * GET /users/{userId}/role-grants actually supports.
 */
export function StaffPage() {
  const schoolId = useOwnedSchoolId();
  const { data: branchData } = useBranches(schoolId);
  const inviteStaff = useInviteStaff();
  const revokeGrant = useRevokeRoleGrant();

  const [inviteUserId, setInviteUserId] = useState('');
  const [role, setRole] = useState<'INSTRUCTOR' | 'BRANCH_STAFF'>('INSTRUCTOR');
  const [branchId, setBranchId] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const [lookupUserId, setLookupUserId] = useState('');
  const [lookupResult, setLookupResult] = useState<RoleGrantResponse[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  if (!schoolId) return null;
  const branches = branchData?.items ?? [];

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(false);
    if (role === 'BRANCH_STAFF' && !branchId) {
      setInviteError('Select a Branch for Branch Staff.');
      return;
    }
    try {
      await inviteStaff.mutateAsync({
        targetUserId: inviteUserId,
        body: { role, schoolId: schoolId!, branchId: role === 'BRANCH_STAFF' ? branchId : undefined },
      });
      setInviteSuccess(true);
      setInviteUserId('');
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
      <PageHeader title="Staff" subtitle="Invite Instructors and Branch Staff to your School." />

      <Card className="ultm8-field">
        <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
          Invite staff
        </h2>
        <form onSubmit={handleInvite}>
          {inviteError ? <ErrorBanner message={inviteError} /> : null}
          {inviteSuccess ? <SuccessBanner message="Invited." /> : null}
          <Field label="User ID" htmlFor="invite-userId" hint="The person must already have a verified ULTM8 account.">
            <TextField required value={inviteUserId} onChange={(e) => setInviteUserId(e.target.value)} />
          </Field>
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
          {role === 'BRANCH_STAFF' ? (
            <Field label="Branch" htmlFor="invite-branch">
              <SelectField
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                options={[{ value: '', label: 'Select a Branch…' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </Field>
          ) : null}
          <Button type="submit" loading={inviteStaff.isPending}>
            Send invite
          </Button>
        </form>
      </Card>

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
          )
        ) : null}
      </Card>
    </>
  );
}
