import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, PhoneField, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from '../branches/branchQueries';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { fetchInviteCandidate, type InviteCandidateResponse } from '../roleGrants/roleGrantQueries';
import { Trans } from '../i18n/Trans';
import { useT } from '../i18n/I18nProvider';

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
      await onSubmit({ targetUserId: candidate!.id!, ...(requiresBranch ? { branchId } : {}) });
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
          <Button type="submit" loading={findLoading}>
            {t('instructors.inviteModal.find')}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleGrant}>
          {error ? <ErrorBanner message={error} /> : null}
          <p className="ultm8-field">
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
            <Field
              label={t('instructors.inviteModal.branch')}
              htmlFor="invite-instructor-branch"
              hint={t('instructors.inviteModal.branchHint')}
            >
              <SelectField
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                options={[{ value: '', label: t('instructors.inviteModal.branchPlaceholder') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </Field>
          ) : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="submit" loading={submitting}>
              {t('instructors.inviteModal.grant')}
            </Button>
            <Button type="button" variant="secondary" onClick={searchAgain}>
              {t('instructors.inviteModal.searchAgain')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
