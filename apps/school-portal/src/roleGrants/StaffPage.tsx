import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, Card, ErrorBanner, Field, PageHeader, PhoneField, SelectField, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, useBranches } from '../branches/branchQueries';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { guessDefaultCountry } from '../lib/phoneCountry';
import {
  fetchInviteCandidate,
  useCreateStaffManually,
  useInviteStaff,
  useRevokeRoleGrant,
  type InviteCandidateResponse,
  type StaffMember,
  type StaffRoleEntry,
} from './roleGrantQueries';
import { StaffListSection } from './StaffListSection';
import { CoachInvitesSection } from './CoachInvitesSection';
import { OpenMatPermissions } from '../frontdesk/OpenMatPermissions';
import { AddStaffManuallyModal } from './AddStaffManuallyModal';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { useT } from '../i18n/I18nProvider';
import { ROLE_LABELS } from '../lib/enumLabels';
import { Trans } from '../i18n/Trans';

/**
 * Invite / revoke Instructor or Branch Staff — the one confirmed RoleGrant authority
 * case (Decision 80/81: School Owner/Manager granting INSTRUCTOR or BRANCH_STAFF
 * within their own School only), plus co-owners (Decision 270: an owner may make
 * another person an owner of their own School; Decision 370 calls them co-owners).
 * No option to grant Franchise Owner, Student, or Guardian: apps/api rejects those
 * from this endpoint.
 *
 * The invite target has no RoleGrant at this School yet, so there's no shared-grant
 * path to look them up by — the form finds them by an exact email or phone match
 * first (GET .../role-grants/invite-candidate, Decision 116: exact match only, never
 * a name search), shows who was found, and only then sends the actual invite.
 *
 * Decision 361 — the page opens on the staff list (StaffListSection), which
 * replaced looking people up by User ID. "Give role" (formerly "Send invite")
 * gives the role at once: there is no invite to accept yet.
 *
 * Decision 251 — "Add staff manually" closes the exact gap the "Find" step above
 * used to dead-end on: no fallback existed when no ULTM8 account was found for the
 * searched email/phone. Mirrors AddInstructorManuallyModal/InstructorsPage's own
 * flow exactly (real User + RoleGrant created immediately, temp passcode emailed,
 * forced change on first login) — minus a third profile-row concern, since "Staff"
 * is just a RoleGrant row (role: BRANCH_STAFF), not a separate profile table.
 */
export function StaffPage() {
  const t = useT();
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
  const [role, setRole] = useState<'INSTRUCTOR' | 'BRANCH_STAFF' | 'SCHOOL_OWNER_MANAGER'>('INSTRUCTOR');
  const [branchId, setBranchId] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  // Non-blocking emailSent flag (same treatment AddInstructorManuallyModal/
  // CoachInvitePage already give it) for the "you've been granted this role"
  // notification RoleGrantsService.create() now sends.
  const [inviteNotice, setInviteNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const [addingManually, setAddingManually] = useState(false);
  // Same non-blocking emailSent treatment as inviteNotice above, for Decision
  // 246's own temp-passcode email.
  const [addManuallyNotice, setAddManuallyNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const [confirmingRevoke, setConfirmingRevoke] = useState<{ person: StaffMember; role: StaffRoleEntry } | null>(null);

  // Owner only (it isn't in the coach nav): anyone else goes to their own
  // home screen rather than a blank page (Decision 296).
  if (!schoolId) return <Navigate to="/" replace />;
  const branches = branchData?.items ?? [];
  // Branch Staff always need a branch. An Instructor needs one whenever the
  // School has branches; with none, the School itself is the branch
  // (Decisions 168, 169).
  // A co-owner is School-wide: never a branch (Decision 370).
  const needsBranch = role === 'BRANCH_STAFF' || (role === 'INSTRUCTOR' && branches.length > 0);
  const roleName = (r: typeof role) =>
    r === 'BRANCH_STAFF' ? t('roleGrants.staff.roleBranchStaff') : r === 'SCHOOL_OWNER_MANAGER' ? t('roleGrants.staff.roleCoOwner') : t('roleGrants.staff.roleInstructor');

  async function handleFind(e: React.FormEvent) {
    e.preventDefault();
    setFindError(null);
    setInviteNotice(null);
    if (!inviteEmail && !invitePhone) {
      setFindError(t('roleGrants.staff.findRequired'));
      return;
    }
    setFindLoading(true);
    try {
      const result = await fetchInviteCandidate(schoolId!, {
        email: inviteEmail || undefined,
        phone: invitePhone || undefined,
      });
      if (!result.found) {
        setFindError(t('roleGrants.staff.notFound'));
        setCandidate(null);
        return;
      }
      setCandidate(result);
    } catch (err) {
      setFindError(err instanceof ApiError ? err.message : t('roleGrants.staff.findFailed'));
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
      setInviteError(role === 'BRANCH_STAFF' ? t('roleGrants.staff.selectBranchForStaff') : t('roleGrants.staff.selectBranchForInstructor'));
      return;
    }
    try {
      const granted = await inviteStaff.mutateAsync({
        targetUserId: candidate!.id!,
        body: { role, schoolId: schoolId!, branchId: needsBranch ? branchId : undefined },
      });
      const given = {
        name: `${candidate!.firstName} ${candidate!.surname}`.trim(),
        role: roleName(role),
      };
      setInviteNotice(
        granted.emailSent
          ? { kind: 'ok', text: t('roleGrants.staff.givenEmailed', given) }
          : { kind: 'warn', text: t('roleGrants.staff.givenNoEmail', given) },
      );
      resetInviteSearch();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  // Errors show in the confirm dialog (ConfirmDeleteModal), which stays open.
  async function handleRevoke({ person, role }: { person: StaffMember; role: StaffRoleEntry }) {
    await revokeGrant.mutateAsync({ targetUserId: person.userId, roleGrantId: role.grantId });
  }

  return (
    <>
      <PageHeader
        title={t('roleGrants.staff.title')}
        subtitle={t('roleGrants.staff.subtitle')}
        actions={
          <Button variant="secondary" onClick={() => setAddingManually(true)}>
            {t('roleGrants.staff.addManuallyButton')}
          </Button>
        }
      />

      {addManuallyNotice?.kind === 'ok' ? <SuccessBanner message={addManuallyNotice.text} /> : null}
      {addManuallyNotice?.kind === 'warn' ? <ErrorBanner message={addManuallyNotice.text} /> : null}

      <StaffListSection schoolId={schoolId} branches={branches} onRevokeRole={(person, role) => setConfirmingRevoke({ person, role })} />

      <Card className="ultm8-field">
        <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
          {t('roleGrants.staff.inviteHeading')}
        </h2>
        <p className="ultm8-field">
          {t('roleGrants.staff.inviteIntro')}
        </p>
        {inviteNotice?.kind === 'ok' ? <SuccessBanner message={inviteNotice.text} /> : null}
        {inviteNotice?.kind === 'warn' ? <ErrorBanner message={inviteNotice.text} /> : null}
        {!candidate ? (
          <form onSubmit={handleFind}>
            {findError ? <ErrorBanner message={findError} /> : null}
            <Field label={t('roleGrants.staff.emailLabel')} htmlFor="invite-email" hint={t('roleGrants.staff.emailHint')}>
              <TextField type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </Field>
            <Field label={t('roleGrants.staff.phoneLabel')} htmlFor="invite-phone" hint={t('roleGrants.staff.phoneHint')}>
              <PhoneField value={invitePhone} onChange={setInvitePhone} defaultCountry={guessDefaultCountry()} />
            </Field>
            <Button type="submit" loading={findLoading}>
              {t('roleGrants.staff.find')}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleInvite}>
            {inviteError ? <ErrorBanner message={inviteError} /> : null}
            <p className="ultm8-field">
              <Trans
                k="roleGrants.staff.found"
                nodes={{
                  name: (
                    <strong>
                      {candidate.firstName} {candidate.surname}
                    </strong>
                  ),
                }}
              />
            </p>
            <Field label={t('roleGrants.staff.roleLabel')} htmlFor="invite-role">
              <SelectField
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                options={[
                  { value: 'INSTRUCTOR', label: t('roleGrants.staff.roleInstructor') },
                  { value: 'BRANCH_STAFF', label: t('roleGrants.staff.roleBranchStaff') },
                  { value: 'SCHOOL_OWNER_MANAGER', label: t('roleGrants.staff.roleCoOwner') },
                ]}
              />
            </Field>
            {role === 'SCHOOL_OWNER_MANAGER' ? <p className="ultm8-field">{t('roleGrants.staff.coOwnerHint')}</p> : null}
            {needsBranch ? (
              <Field
                label={t('roleGrants.staff.branchLabel')}
                htmlFor="invite-branch"
                hint={role === 'INSTRUCTOR' ? t('roleGrants.staff.branchHint') : undefined}
              >
                <SelectField
                  required
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  options={[{ value: '', label: t('roleGrants.staff.selectBranch') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
                />
              </Field>
            ) : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="submit" loading={inviteStaff.isPending}>
                {t('roleGrants.staff.giveRole')}
              </Button>
              <Button type="button" variant="secondary" onClick={resetInviteSearch}>
                {t('roleGrants.staff.searchAgain')}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <CoachInvitesSection schoolId={schoolId} />
      {/* Decision 386: who may start an open mat from the Check-in page. */}
      <OpenMatPermissions schoolId={schoolId} />

      {confirmingRevoke?.role.role === 'SCHOOL_OWNER_MANAGER' ? (
        <ConfirmDeleteModal
          title={t('roleGrants.staff.removeCoOwnerTitle', { name: `${confirmingRevoke.person.firstName} ${confirmingRevoke.person.surname}`.trim() })}
          description={t('roleGrants.staff.removeCoOwnerDescription')}
          confirmLabel={t('roleGrants.list.removeCoOwner')}
          genericErrorMessage={t('roleGrants.staff.revokeFailed')}
          onConfirm={() => handleRevoke(confirmingRevoke)}
          onClose={() => setConfirmingRevoke(null)}
        />
      ) : confirmingRevoke ? (
        <ConfirmDeleteModal
          title={t('roleGrants.staff.revokeTitle', {
            role: ROLE_LABELS[confirmingRevoke.role.role] ? t(ROLE_LABELS[confirmingRevoke.role.role]!) : confirmingRevoke.role.role,
            name: `${confirmingRevoke.person.firstName} ${confirmingRevoke.person.surname}`.trim(),
          })}
          description={t('roleGrants.staff.revokeDescription', {
            branch: confirmingRevoke.role.branchName ?? t('roleGrants.coachInvites.wholeSchool'),
          })}
          confirmLabel={t('roleGrants.staff.revoke')}
          genericErrorMessage={t('roleGrants.staff.revokeFailed')}
          onConfirm={() => handleRevoke(confirmingRevoke)}
          onClose={() => setConfirmingRevoke(null)}
        />
      ) : null}

      {addingManually ? (
        <AddStaffManuallyModal
          branches={branches}
          submitting={createStaffManually.isPending}
          onSubmit={async (values) => {
            const created = await createStaffManually.mutateAsync(values);
            setAddManuallyNotice(
              created.emailSent
                ? {
                    kind: 'ok',
                    text: t('roleGrants.staff.addedEmailed', { name: `${created.userFirstName} ${created.userSurname}`, email: created.email }),
                  }
                : {
                    kind: 'warn',
                    text: t('roleGrants.staff.addedNoEmail', { name: `${created.userFirstName} ${created.userSurname}` }),
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
