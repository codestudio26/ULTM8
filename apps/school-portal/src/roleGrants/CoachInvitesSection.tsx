import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, SelectField, Spinner, SuccessBanner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, useBranches } from '../branches/branchQueries';
import {
  useCancelCoachInvite,
  useCoachInvites,
  useSendCoachInvite,
  type CoachInvite,
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
 * email. The link works once, for 7 days, and can be cancelled. Which Branch
 * Staff may also invite coaches, for their own branches, is one of their
 * access switches on the staff list (Decision 387).
 */
export function CoachInvitesSection({
  schoolId,
  allowedBranchIds,
}: {
  schoolId: string;
  /** Branch Staff (Decision 183): only their own branches. Omitted for the
   * owner. */
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
                options={[{ value: '', label: t('roleGrants.coachInvites.selectBranch') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
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
              // Decision 396: Branch Staff invites, from "New staff must accept first".
              ...(invites.data!.items.some((i) => i.role === 'BRANCH_STAFF')
                ? [
                    {
                      key: 'role',
                      header: t('roleGrants.coachInvites.columnRole'),
                      render: (i: CoachInvite) => (i.role === 'BRANCH_STAFF' ? t('roleGrants.staff.roleBranchStaff') : t('roleGrants.staff.roleInstructor')),
                    },
                  ]
                : []),
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
    </>
  );
}
