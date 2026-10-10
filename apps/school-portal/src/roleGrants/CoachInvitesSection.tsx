import React, { useState } from 'react';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, SelectField, Spinner, SuccessBanner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useBranches } from '../branches/branchQueries';
import {
  useCancelCoachInvite,
  useCoachInvites,
  useSendCoachInvite,
  useSetCanInviteCoaches,
  useStaffPermissions,
  type CoachInvite,
  type StaffPermission,
} from './coachInviteQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const STATUS: Record<CoachInvite['status'], { label: string; variant: 'default' | 'accent' | 'success' | 'danger' }> = {
  PENDING: { label: 'Waiting', variant: 'accent' },
  ACCEPTED: { label: 'Accepted', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'default' },
  EXPIRED: { label: 'Expired', variant: 'danger' },
};

/**
 * Coach invites (Decision 183): email one person a link that makes them a
 * coach at this School (and branch) when they accept it, signed in with that
 * email. The link works once, for 7 days, and can be cancelled. Below, the
 * owner chooses which Branch Staff may also invite coaches, for their own
 * branches.
 */
export function CoachInvitesSection({ schoolId }: { schoolId: string }) {
  const { data: branchData } = useBranches(schoolId);
  const invites = useCoachInvites(schoolId);
  const send = useSendCoachInvite(schoolId);
  const cancel = useCancelCoachInvite(schoolId);
  const [email, setEmail] = useState('');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const branches = branchData?.items ?? [];
  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? '—' : 'Whole School');

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (branches.length > 0 && !branchId) {
      setError('Choose the branch this coach will be at.');
      return;
    }
    try {
      const invite = await send.mutateAsync({ email: email.trim(), ...(branches.length > 0 ? { branchId } : {}) });
      setNotice(
        invite.emailSent
          ? { kind: 'ok', text: `Invite sent to ${invite.email}. The link works once, for 7 days.` }
          : { kind: 'warn', text: `The invite to ${invite.email} was saved, but the email couldn't be sent. Cancel it and try again.` },
      );
      setEmail('');
    } catch (err) {
      setError(errorText(err, 'Could not send the invite.'));
    }
  }

  async function handleCancel(invite: CoachInvite) {
    setError(null);
    setNotice(null);
    try {
      await cancel.mutateAsync(invite.id);
      setNotice({ kind: 'ok', text: `Invite to ${invite.email} cancelled. Its link no longer works.` });
    } catch (err) {
      setError(errorText(err, 'Could not cancel the invite.'));
    }
  }

  return (
    <>
      <Card className="ultm8-field">
        <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
          Invite a coach
        </h2>
        <p style={{ marginTop: 0 }}>
          We email them a link. They open it and sign in, or create their account, with that email, and become a coach here. If they already
          train here, they keep their student account too.
        </p>
        {notice?.kind === 'ok' ? <SuccessBanner message={notice.text} /> : null}
        {notice?.kind === 'warn' ? <ErrorBanner message={notice.text} /> : null}
        {error ? <ErrorBanner message={error} /> : null}
        <form onSubmit={handleSend}>
          <Field label="Coach's email" htmlFor="coach-invite-email">
            <TextField type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {branches.length > 0 ? (
            <Field label="Branch" htmlFor="coach-invite-branch">
              <SelectField
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                options={[{ value: '', label: 'Select a branch…' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </Field>
          ) : null}
          <Button type="submit" loading={send.isPending}>
            Send invite
          </Button>
        </form>

        <h3 style={{ fontSize: 16, margin: '24px 0 8px' }}>Invites</h3>
        {invites.isLoading ? (
          <Spinner />
        ) : invites.error ? (
          <ErrorBanner message={errorText(invites.error, 'Could not load invites.')} />
        ) : (invites.data?.items ?? []).length === 0 ? (
          <EmptyState title="No coach invites yet" />
        ) : (
          <Table<CoachInvite>
            rows={invites.data!.items}
            columns={[
              { key: 'email', header: 'Email', render: (i) => i.email },
              ...(branches.length > 0 ? [{ key: 'branch', header: 'Branch', render: (i: CoachInvite) => i.branchName ?? branchName(i.branchId) }] : []),
              { key: 'status', header: 'Status', render: (i) => <Badge variant={STATUS[i.status].variant}>{STATUS[i.status].label}</Badge> },
              { key: 'sent', header: 'Sent', render: (i) => `${shortDate(i.createdAt)}${i.invitedByName ? ` by ${i.invitedByName}` : ''}` },
              { key: 'expires', header: 'Expires', render: (i) => (i.status === 'PENDING' ? shortDate(i.expiresAt) : '—') },
              {
                key: 'actions',
                header: '',
                render: (i) =>
                  i.status === 'PENDING' ? (
                    <Button variant="secondary" onClick={() => handleCancel(i)} aria-label={`Cancel invite to ${i.email}`}>
                      Cancel
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>

      <InviterPermissions schoolId={schoolId} branchName={branchName} />
    </>
  );
}

/** "Can invite coaches", per Branch Staff member, for their own branches.
 * Coaches can't be given it (Spec 55 §8.2). */
function InviterPermissions({ schoolId, branchName }: { schoolId: string; branchName: (id: string | null) => string }) {
  const staff = useStaffPermissions(schoolId);
  const setAllowed = useSetCanInviteCoaches(schoolId);
  const [error, setError] = useState<string | null>(null);
  // Shows the new state at once; it goes back if saving fails.
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  async function toggle(person: StaffPermission, canInviteCoaches: boolean) {
    setError(null);
    setSaving((m) => ({ ...m, [person.userId]: canInviteCoaches }));
    try {
      await setAllowed.mutateAsync({ userId: person.userId, canInviteCoaches });
    } catch (err) {
      setError(errorText(err, 'Could not save.'));
    } finally {
      setSaving(({ [person.userId]: _done, ...rest }) => rest);
    }
  }

  return (
    <Card className="ultm8-field">
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        Who can invite coaches
      </h2>
      <p style={{ marginTop: 0 }}>You always can. Branch Staff you tick here can invite coaches to their own branches.</p>
      {error ? <ErrorBanner message={error} /> : null}
      {staff.isLoading ? (
        <Spinner />
      ) : staff.error ? (
        <ErrorBanner message={errorText(staff.error, 'Could not load staff.')} />
      ) : (staff.data?.items ?? []).length === 0 ? (
        <EmptyState title="No Branch Staff yet" description="Add Branch Staff above to let them invite coaches." />
      ) : (
        <Table<StaffPermission & { id: string }>
          rows={staff.data!.items.map((p) => ({ ...p, id: p.userId }))}
          columns={[
            { key: 'name', header: 'Name', render: (p) => `${p.firstName} ${p.surname}` },
            { key: 'branches', header: 'Branches', render: (p) => (p.branchIds.length ? p.branchIds.map(branchName).join(', ') : 'Whole School') },
            {
              key: 'allowed',
              header: 'Can invite coaches',
              render: (p) => (
                <Checkbox
                  label={`${p.firstName} ${p.surname} can invite coaches`}
                  checked={saving[p.userId] ?? p.canInviteCoaches}
                  disabled={p.userId in saving}
                  onChange={(e) => toggle(p, e.target.checked)}
                />
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}
