import React, { useState } from 'react';
import { Button, EmptyState, ErrorBanner, Field, Spinner, SuccessBanner, TextField } from '@ultm8/ui';
import { TeamCard } from '../team/TeamParts';
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
import { NewLookSelect } from '../layout/NewLookSelect';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });

/** Each status's tag: Waiting blue, Accepted green, Cancelled grey, Expired red. */
const STATUS: Record<CoachInvite['status'], { label: TranslationKey; tag: string }> = {
  PENDING: { label: 'roleGrants.coachInvites.statusPending', tag: ' u8t-tag--info' },
  ACCEPTED: { label: 'roleGrants.coachInvites.statusAccepted', tag: ' u8t-tag--ok' },
  CANCELLED: { label: 'roleGrants.coachInvites.statusCancelled', tag: '' },
  EXPIRED: { label: 'roleGrants.coachInvites.statusExpired', tag: ' u8t-tag--bad' },
};

/**
 * Coach invites (Decision 183): email one person a link that makes them a
 * coach at this School (and branch) when they accept it, signed in with that
 * email. The link works once, for 7 days, and can be cancelled. Only the
 * School's main owner sends and cancels invites (Decision 423 item 10);
 * co-owners see the list, read only.
 */
export function CoachInvitesSection({
  schoolId,
  canManage,
}: {
  schoolId: string;
  /** The School's main owner: may send and cancel. Undefined while not known yet. */
  canManage: boolean | undefined;
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

  const branches = branchData?.items ?? [];
  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? '—' : t('roleGrants.coachInvites.wholeSchool'));

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

  const items = invites.data?.items ?? [];
  const hasStaffInvites = items.some((i) => i.role === 'BRANCH_STAFF');
  return (
    <>
      <TeamCard title={t('roleGrants.coachInvites.heading')} intro={t('roleGrants.coachInvites.intro')}>
        <div className="u8t-card__body">
        {notice?.kind === 'ok' ? <SuccessBanner message={notice.text} /> : null}
        {notice?.kind === 'warn' ? <ErrorBanner message={notice.text} /> : null}
        {error ? <ErrorBanner message={error} /> : null}
        {canManage ? (
        <form onSubmit={handleSend}>
          <Field label={t('roleGrants.coachInvites.emailLabel')} htmlFor="coach-invite-email">
            <TextField type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {branches.length > 0 ? (
            // No browser `required` check: handleSend's own branch check
            // (and its message) decides.
            <div className="u8n-dd-field">
              <NewLookSelect
                id="coach-invite-branch"
                label={t('roleGrants.coachInvites.branchLabel')}
                value={branchId}
                onChange={setBranchId}
                options={[{ value: '', label: t('roleGrants.coachInvites.selectBranch') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
              />
            </div>
          ) : null}
          <div className="u8t-form-actions">
            <Button type="submit" loading={send.isPending}>
              {t('roleGrants.coachInvites.sendInvite')}
            </Button>
          </div>
        </form>
        ) : canManage === false ? (
          <p className="ultm8-field">{t('roleGrants.staff.mainOwnerOnly')}</p>
        ) : null}
        </div>
      </TeamCard>

      <TeamCard title={t('roleGrants.coachInvites.invitesHeading')}>
        {invites.isLoading ? (
          <div className="u8t-state">
            <Spinner />
          </div>
        ) : invites.error ? (
          <div className="u8t-state">
            <ErrorBanner message={errorText(invites.error, t('roleGrants.coachInvites.loadFailed'))} />
          </div>
        ) : items.length === 0 ? (
          <div className="u8t-state">
            <EmptyState title={t('roleGrants.coachInvites.emptyTitle')} />
          </div>
        ) : (
          <table className="u8t-table">
            <thead>
              <tr>
                <th scope="col">{t('roleGrants.coachInvites.columnEmail')}</th>
                {/* Decision 396: Branch Staff invites, from "New staff must accept first". */}
                {hasStaffInvites ? <th scope="col">{t('roleGrants.coachInvites.columnRole')}</th> : null}
                {branches.length > 0 ? <th scope="col">{t('roleGrants.coachInvites.columnBranch')}</th> : null}
                <th scope="col">{t('roleGrants.coachInvites.columnStatus')}</th>
                <th scope="col">{t('roleGrants.coachInvites.columnSent')}</th>
                <th scope="col">{t('roleGrants.coachInvites.columnExpires')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="u8t-c-main" style={{ overflowWrap: 'anywhere' }}>
                    {i.email}
                  </td>
                  {hasStaffInvites ? (
                    <td>
                      <span className="u8t-k">{t('roleGrants.coachInvites.columnRole')}: </span>
                      {i.role === 'BRANCH_STAFF' ? t('roleGrants.staff.roleBranchStaff') : t('roleGrants.staff.roleInstructor')}
                    </td>
                  ) : null}
                  {branches.length > 0 ? (
                    <td>
                      <span className="u8t-k">{t('roleGrants.coachInvites.columnBranch')}: </span>
                      {i.branchName ?? branchName(i.branchId)}
                    </td>
                  ) : null}
                  <td className="u8t-c-end">
                    <span className={'u8t-tag' + STATUS[i.status].tag}>{t(STATUS[i.status].label)}</span>
                  </td>
                  <td>
                    <span className="u8t-k">{t('roleGrants.coachInvites.columnSent')}: </span>
                    {i.invitedByName ? t('roleGrants.coachInvites.sentBy', { date: shortDate(i.createdAt), name: i.invitedByName }) : shortDate(i.createdAt)}
                  </td>
                  <td>
                    <span className="u8t-k">{t('roleGrants.coachInvites.columnExpires')}: </span>
                    {i.status === 'PENDING' ? shortDate(i.expiresAt) : '—'}
                  </td>
                  <td className="u8t-c-act">
                    {canManage && i.status === 'PENDING' ? (
                      <div className="u8t-actions">
                        <button type="button" className="u8t-pill u8t-pill--sm" onClick={() => handleCancel(i)} aria-label={t('roleGrants.coachInvites.cancelAria', { email: i.email })}>
                          {t('roleGrants.coachInvites.cancel')}
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TeamCard>
    </>
  );
}
