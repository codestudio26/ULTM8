import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, ModalActions, PhoneField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, type BranchResponse } from '../branches/branchQueries';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { fetchInviteCandidate, type InviteCandidateResponse } from '../roleGrants/roleGrantQueries';
import { Trans } from '../i18n/Trans';
import { useT } from '../i18n/I18nProvider';
import { NewLookSelect } from '../layout/NewLookSelect';

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
 * Giving the role also makes the person's (empty) Instructor profile (owner's
 * choice, 14 Nov 2026), so after this modal closes the Instructors page opens
 * that profile for editing.
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
  onSubmit: (values: { targetUserId: string; email: string; name: string; branchId?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
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
      setError(t('instructors.inviteModal.enterEmailOrPhone'));
      return;
    }
    setFindLoading(true);
    try {
      const result = await fetchInviteCandidate(schoolId, { email: email || undefined, phone: phone || undefined });
      if (!result.found) {
        setError(t('instructors.inviteModal.notFound'));
        setCandidate(null);
        return;
      }
      setCandidate(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('instructors.inviteModal.searchFailed'));
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
      setError(t('instructors.inviteModal.selectBranch'));
      return;
    }
    try {
      await onSubmit({ targetUserId: candidate!.id!, email: candidate!.email ?? '', name: `${candidate!.firstName ?? ''} ${candidate!.surname ?? ''}`.trim(), ...(requiresBranch ? { branchId } : {}) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('instructors.inviteModal.title')} onClose={onClose}>
      {!candidate ? (
        <form onSubmit={handleFind}>
          {error ? <ErrorBanner message={error} /> : null}
          <p className="ultm8-field">{t('instructors.inviteModal.intro')}</p>
          <Field label={t('instructors.inviteModal.email')} htmlFor="invite-instructor-email" hint={t('instructors.inviteModal.emailHint')}>
            <TextField type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('instructors.inviteModal.phone')} htmlFor="invite-instructor-phone" hint={t('instructors.inviteModal.phoneHint')}>
            <PhoneField value={phone} onChange={setPhone} defaultCountry={guessDefaultCountry()} />
          </Field>
          <ModalActions>
            <Button type="submit" loading={findLoading}>
              {t('instructors.inviteModal.find')}
            </Button>
          </ModalActions>
        </form>
      ) : (
        <form onSubmit={handleGrant}>
          {error ? <ErrorBanner message={error} /> : null}
          <p className="u8t-found">
            <Trans
              k="instructors.inviteModal.found"
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
          {requiresBranch ? (
            // No browser `required` check: handleGrant's own branch check
            // (and its message) decides.
            <div className="u8n-dd-field">
              <NewLookSelect
                id="invite-instructor-branch"
                label={t('instructors.inviteModal.branch')}
                value={branchId}
                onChange={setBranchId}
                options={[{ value: '', label: t('instructors.inviteModal.branchPlaceholder') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
              />
              <span className="ultm8-field__hint u8n-dd-field__hint">{t('instructors.inviteModal.branchHint')}</span>
            </div>
          ) : null}
          <ModalActions>
            <Button type="button" variant="secondary" onClick={searchAgain}>
              {t('instructors.inviteModal.searchAgain')}
            </Button>
            <Button type="submit" loading={submitting}>
              {t('instructors.inviteModal.grant')}
            </Button>
          </ModalActions>
        </form>
      )}
    </Modal>
  );
}
