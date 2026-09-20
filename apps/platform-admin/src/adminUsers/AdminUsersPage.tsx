import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, SelectField, Spinner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAdminUsers, useCreateAdminUser, useRevokeAdminUser, type AdminUserResponse, type CreateAdminUserInput } from './adminUserQueries';

const SUB_ROLES = ['SUPPORT', 'BILLING_PAYMENTS_OPS', 'FULL_ADMIN'] as const;

function subRoleLabel(subRole: AdminUserResponse['subRole']): string {
  switch (subRole) {
    case 'FULL_ADMIN':
      return 'Full Admin';
    case 'BILLING_PAYMENTS_OPS':
      return 'Billing/Payments Ops';
    case 'SUPPORT':
      return 'Support';
  }
}

/** The AdminUser roster — invite (Slice 4), list (Slice 4), revoke (Slice 5). The
 * one screen in Slice 1 that exercises PlatformAdminModule's full write surface;
 * School/Franchise/PaymentAccount read screens are each their own later slice —
 * not built here (see this app's own README for the full "not yet built" list).
 * FULL_ADMIN-only server-side; a SUPPORT/BILLING_PAYMENTS_OPS caller sees this
 * screen's own error state (403) rather than the roster, same "backend is the
 * real authorization boundary, nav isn't role-gated client-side" convention
 * apps/school-portal's own FranchisesPage header comment already establishes. */
export function AdminUsersPage() {
  const { data, isLoading, error } = useAdminUsers();
  const createAdminUser = useCreateAdminUser();
  const revokeAdminUser = useRevokeAdminUser();
  const [inviting, setInviting] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  // FOUND ON REVIEW: a first draft drove each row's loading spinner off
  // `revokeAdminUser.isPending && revokeAdminUser.variables === a.id` — correct
  // for a single in-flight revoke, but all rows share one useRevokeAdminUser()
  // mutation instance, so clicking Revoke on a second row while the first is
  // still pending reassigns the shared `variables` mid-flight: row A's spinner
  // silently turns off (even though its request is still running) and row B's
  // turns on instead. Tracked here in local state instead, one id at a time,
  // so each row's own in-flight status is independent of any other row's.
  const [revokingId, setRevokingId] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load the admin roster.'} />;

  const admins = data?.items ?? [];

  async function handleRevoke(admin: AdminUserResponse) {
    setRevokeError(null);
    setRevokingId(admin.id);
    try {
      await revokeAdminUser.mutateAsync(admin.id);
    } catch (err) {
      // Surfaces the server's own last-active-FULL_ADMIN lockout guard (409) or
      // any other rejection directly — not guessed at or re-worded client-side.
      setRevokeError(err instanceof ApiError ? err.message : 'Could not revoke this admin.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Admin Users"
        subtitle="Who has Platform Admin access, and at what tier. Inviting and revoking are both Full Admin-only."
        actions={<Button onClick={() => setInviting(true)}>Invite admin</Button>}
      />
      {revokeError ? <ErrorBanner message={revokeError} /> : null}
      <Card>
        {admins.length === 0 ? (
          <EmptyState title="No admins visible" description="Either none exist yet, or your own account isn't Full Admin — this list is Full Admin-only." />
        ) : (
          <Table<AdminUserResponse>
            rows={admins}
            columns={[
              { key: 'name', header: 'Name', render: (a) => a.name },
              { key: 'email', header: 'Email', render: (a) => a.email },
              { key: 'subRole', header: 'Tier', render: (a) => <Badge variant="accent">{subRoleLabel(a.subRole)}</Badge> },
              {
                key: 'status',
                header: 'Status',
                render: (a) => (a.revokedAt ? <Badge variant="danger">Revoked</Badge> : <Badge variant="success">Active</Badge>),
              },
              {
                key: 'actions',
                header: '',
                render: (a) =>
                  a.revokedAt ? null : (
                    <Button variant="danger" onClick={() => handleRevoke(a)} disabled={revokingId !== null} loading={revokingId === a.id}>
                      Revoke
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </Card>

      {inviting ? (
        <InviteAdminModal
          submitting={createAdminUser.isPending}
          onSubmit={async (values) => {
            await createAdminUser.mutateAsync(values);
            setInviting(false);
          }}
          onClose={() => setInviting(false)}
        />
      ) : null}
    </>
  );
}

function InviteAdminModal({
  submitting,
  onSubmit,
  onClose,
}: {
  submitting: boolean;
  onSubmit: (values: CreateAdminUserInput) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ email: '', name: '', subRole: 'SUPPORT' as CreateAdminUserInput['subRole'], ssoSubject: '' });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      // Surfaces the server's own 409 (duplicate email/ssoSubject) directly —
      // not re-derived or guessed at client-side.
      setError(err instanceof ApiError ? err.message : 'Could not invite this admin.');
    }
  }

  return (
    <Modal title="Invite admin" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Email" htmlFor="invite-email">
          <TextField
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </Field>
        <Field label="Name" htmlFor="invite-name">
          <TextField required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Tier" htmlFor="invite-subrole">
          <SelectField
            id="invite-subrole"
            options={SUB_ROLES.map((r) => ({ value: r, label: subRoleLabel(r as AdminUserResponse['subRole']) }))}
            value={form.subRole}
            onChange={(e) => setForm((f) => ({ ...f, subRole: e.target.value as CreateAdminUserInput['subRole'] }))}
          />
        </Field>
        <Field
          label="Cognito sub"
          htmlFor="invite-sso-subject"
          hint="The Cognito user's own `sub` claim — create the Cognito user first (Console or admin-create-user), then paste its sub here. See CreateAdminUserDto's own comment on why identity (Cognito) and authorization (this record) are two separate steps."
        >
          <TextField
            required
            value={form.ssoSubject}
            onChange={(e) => setForm((f) => ({ ...f, ssoSubject: e.target.value }))}
          />
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          Invite
        </Button>
      </form>
    </Modal>
  );
}
