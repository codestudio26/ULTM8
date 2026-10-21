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
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });

const STATUS: Record<CoachInvite['status'], { label: TranslationKey; variant: 'default' | 'accent' | 'success' | 'danger' }> = {
  PENDING: { label: 'roleGrants.coachInvites.statusPending', variant: 'accent' },
  ACCEPTED: { label: 'roleGrants.coachInvites.statusAccepted', variant: 'success' },
  CANCELLED: { label: 'roleGrants.coachInvites.statusCancelled', variant: 'default' },
  EXPIRED: { label: 'roleGrants.coachInvites.statusExpired', variant: 'danger' },
};

/**
 * Coach invites (Decision 183): email one person a link that makes them a
 * coach at this School (and branch) when they accept it, signed in with that
 * email. The link works once, for 7 days, and can be cancelled. Below, the
 * owner chooses which Branch Staff may also invite coaches, for their own
 * branches.
 */
export function CoachInvitesSection({
  schoolId,
  allowedBranchIds,
}: {
  schoolId: string;
  /** Branch Staff (Decision 183): only their own branches, and no "Who can
   * invite coaches" card, which is the owner's. Omitted for the owner. */
  allowedBranchIds?: string[];
}) {
  const t = useT();
  const { data: branchData } = useBranches(schoolId);
  const invites = useCoachInvites(schoolId);
  const send = useSendCoachInvite(schoolId);
  const cancel = useCancelCoachInvite(schoolId);
  const [email, setEmail] = useState('');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const allBranches = branchData?.items ?? [];
  const branches = allowedBranchIds ? allBranches.filter((b) => allowedBranchIds.includes(b.id)) : allBranches;
  const branchName = (id: string | null) => (id ? allBranches.find((b) => b.id === id)?.name ?? '—' : t('roleGrants.coachInvites.wholeSchool'));

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (branches.length > 0 && !branchId) {
      setError(t('roleGrants.coachInvites.chooseBranch'));
      return;
    }
    try {
      const invite = await send.mutateAsync({ email: email.trim(), ...(branches.length > 0 ? { branchId } : {}) });
      setNotice(
        invite.emailSent
          ? { kind: 'ok', text: t('roleGrants.coachInvites.sentEmailed', { email: invite.email }) }
          : { kind: 'warn', text: t('roleGrants.coachInvites.sentNoEmail', { email: invite.email }) },
      );
      setEmail('');
    } catch (err) {
      setError(errorText(err, t('roleGrants.coachInvites.sendFailed')));
    }
  }

  async function handleCancel(invite: CoachInvite) {
    setError(null);
    setNotice(null);
    try {
      await cancel.mutateAsync(invite.id);
      setNotice({ kind: 'ok', text: t('roleGrants.coachInvites.cancelledNotice', { email: invite.email }) });
    } catch (err) {
      setError(errorText(err, t('roleGrants.coachInvites.cancelFailed')));
    }
  }

  return (
    <>
      <Card className="ultm8-field">
        <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
          {t('roleGrants.coachInvites.heading')}
        </h2>
        <p style={{ marginTop: 0 }}>
          {t('roleGrants.coachInvites.intro')}
        </p>
        {notice?.kind === 'ok' ? <SuccessBanner message={notice.text} /> : null}
        {notice?.kind === 'warn' ? <ErrorBanner message={notice.text} /> : null}
        {error ? <ErrorBanner message={error} /> : null}
        <form onSubmit={handleSend}>
          <Field label={t('roleGrants.coachInvites.emailLabel')} htmlFor="coach-invite-email">
            <TextField type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {branches.length > 0 ? (
            <Field label={t('roleGrants.coachInvites.branchLabel')} htmlFor="coach-invite-branch">
              <SelectField
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                options={[{ value: '', label: t('roleGrants.coachInvites.selectBranch') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </Field>
          ) : null}
          <Button type="submit" loading={send.isPending}>
            {t('roleGrants.coachInvites.sendInvite')}
          </Button>
        </form>

        <h3 style={{ fontSize: 16, margin: '24px 0 8px' }}>{t('roleGrants.coachInvites.invitesHeading')}</h3>
        {invites.isLoading ? (
          <Spinner />
        ) : invites.error ? (
          <ErrorBanner message={errorText(invites.error, t('roleGrants.coachInvites.loadFailed'))} />
        ) : (invites.data?.items ?? []).length === 0 ? (
          <EmptyState title={t('roleGrants.coachInvites.emptyTitle')} />
        ) : (
          <Table<CoachInvite>
            rows={invites.data!.items}
            columns={[
              { key: 'email', header: t('roleGrants.coachInvites.columnEmail'), render: (i) => i.email },
              ...(branches.length > 0 ? [{ key: 'branch', header: t('roleGrants.coachInvites.columnBranch'), render: (i: CoachInvite) => i.branchName ?? branchName(i.branchId) }] : []),
              { key: 'status', header: t('roleGrants.coachInvites.columnStatus'), render: (i) => <Badge variant={STATUS[i.status].variant}>{t(STATUS[i.status].label)}</Badge> },
              {
                key: 'sent',
                header: t('roleGrants.coachInvites.columnSent'),
                render: (i) =>
                  i.invitedByName
                    ? t('roleGrants.coachInvites.sentBy', { date: shortDate(i.createdAt), name: i.invitedByName })
                    : shortDate(i.createdAt),
              },
              { key: 'expires', header: t('roleGrants.coachInvites.columnExpires'), render: (i) => (i.status === 'PENDING' ? shortDate(i.expiresAt) : '—') },
              {
                key: 'actions',
                header: '',
                render: (i) =>
                  i.status === 'PENDING' ? (
                    <Button variant="secondary" onClick={() => handleCancel(i)} aria-label={t('roleGrants.coachInvites.cancelAria', { email: i.email })}>
                      {t('roleGrants.coachInvites.cancel')}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>

      {allowedBranchIds ? null : <InviterPermissions schoolId={schoolId} branchName={branchName} />}
    </>
  );
}

/** "Can invite coaches", per Branch Staff member, for their own branches.
 * Coaches can't be given it (Spec 55 §8.2). */
function InviterPermissions({ schoolId, branchName }: { schoolId: string; branchName: (id: string | null) => string }) {
  const t = useT();
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
      setError(errorText(err, t('roleGrants.permissions.saveFailed')));
    } finally {
      setSaving(({ [person.userId]: _done, ...rest }) => rest);
    }
  }

  return (
    <Card className="ultm8-field">
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        {t('roleGrants.permissions.heading')}
      </h2>
      <p style={{ marginTop: 0 }}>{t('roleGrants.permissions.intro')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {staff.isLoading ? (
        <Spinner />
      ) : staff.error ? (
        <ErrorBanner message={errorText(staff.error, t('roleGrants.permissions.loadFailed'))} />
      ) : (staff.data?.items ?? []).length === 0 ? (
        <EmptyState title={t('roleGrants.permissions.emptyTitle')} description={t('roleGrants.permissions.emptyDescription')} />
      ) : (
        <Table<StaffPermission & { id: string }>
          rows={staff.data!.items.map((p) => ({ ...p, id: p.userId }))}
          columns={[
            { key: 'name', header: t('roleGrants.permissions.columnName'), render: (p) => `${p.firstName} ${p.surname}` },
            {
              key: 'branches',
              header: t('roleGrants.permissions.columnBranches'),
              render: (p) => (p.branchIds.length ? p.branchIds.map(branchName).join(', ') : t('roleGrants.coachInvites.wholeSchool')),
            },
            {
              key: 'allowed',
              header: t('roleGrants.permissions.columnAllowed'),
              render: (p) => (
                <Checkbox
                  label={t('roleGrants.permissions.checkboxLabel', { name: `${p.firstName} ${p.surname}` })}
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
