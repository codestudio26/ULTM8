import React, { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorBanner, RowActionsMenu, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { matchesNameSearch } from '@ultm8/i18n';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { useInviteStaff } from '../roleGrants/roleGrantQueries';
import {
  useArchiveInstructor,
  useCreateInstructor,
  useCreateInstructorManually,
  useEligibleInstructorUsers,
  useInstructors,
  useUnarchiveInstructor,
  useUpdateInstructor,
  type InstructorResponse,
} from './instructorQueries';
import { InstructorFormModal } from './InstructorFormModal';
import { AddInstructorManuallyModal } from './AddInstructorManuallyModal';
import { InviteToInstructorRoleModal } from './InviteToInstructorRoleModal';
import { useIsMainOwner } from '../roleGrants/roleGrantQueries';
import { InstructorBeltsSection } from './InstructorBeltsSection';
import { useT } from '../i18n/I18nProvider';
import { NewLookPage } from '../layout/NewLookPage';
import { TeamSelect } from '../team/TeamSelect';
import { FrontDeskSwitches, OpenFullPageLink, TeamAvatar, TeamCard, TeamHeader, TeamPanelWho, TeamSearch, pickRow, showPanel, teamPanel } from '../team/TeamParts';

/** Up to 3 specialization badges, then a "+N" overflow badge — keeps a long
 * specializations list from blowing out the row height instead of silently
 * dropping data (every specialization is still in the Edit form). */
function SpecializationBadges({ specializations }: { specializations: string[] }) {
  if (!specializations.length) return <>—</>;
  const shown = specializations.slice(0, 3);
  const overflow = specializations.length - shown.length;
  return (
    <span className="u8t-tags">
      {shown.map((s, idx) => (
        <span key={`${s}-${idx}`} className="u8t-tag u8t-tag--info">
          {s}
        </span>
      ))}
      {overflow > 0 ? <span className="u8t-tag">+{overflow}</span> : null}
    </span>
  );
}

/** The Branch filter's "whole School" choice (profiles with no branch). */
const WHOLE_SCHOOL = '__whole-school__';
/** Status filter value for "Hasn't signed in yet" (Decision 312). */
const AWAITING = '__awaiting__';

export function InstructorsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const schoolId = useOwnedSchoolId();
  // Decision 423 item 10: only the main owner gives the coach role.
  const isMainOwner = useIsMainOwner(schoolId);
  const { data, isLoading, error } = useInstructors(schoolId);
  const { data: branchData } = useBranches(schoolId);
  // Archived styles too: the forms show one a record already has (Decision 310).
  const { data: disciplineData } = useDisciplines(schoolId, { includeArchived: true });
  const { data: eligibleUsersData } = useEligibleInstructorUsers(schoolId);
  const createInstructor = useCreateInstructor(schoolId ?? '');
  const createInstructorManually = useCreateInstructorManually(schoolId ?? '');
  const archiveInstructor = useArchiveInstructor(schoolId ?? '');
  const unarchiveInstructor = useUnarchiveInstructor(schoolId ?? '');
  const inviteToInstructorRole = useInviteStaff();
  const [creating, setCreating] = useState(false);
  // Who "Add instructor" starts on, right after "Invite existing user"
  // granted them the role (Decision 312, F9): one flow instead of two.
  const [createPreset, setCreatePreset] = useState<{ userId: string; branchId: string | null } | null>(null);
  const [addingManually, setAddingManually] = useState(false);
  const [invitingExisting, setInvitingExisting] = useState(false);
  const [editing, setEditing] = useState<InstructorResponse | null>(null);
  // Decision 1/230/237 — emailSent is non-blocking: the Instructor record
  // was created either way, same "save the write, warn about the side
  // effect" treatment CoachInvitesSection already gives this exact flag.
  const [addManuallyNotice, setAddManuallyNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  // Same non-blocking emailSent treatment, for the "you've been granted the
  // Instructor role" notification RoleGrantsService.create() now sends.
  const [inviteRoleNotice, setInviteRoleNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Decision 226 — archived Instructor profiles are excluded by default,
  // same "excluded by default, visible via a filter" convention this build
  // applies to every one of the 7 entities; the full list (including
  // archived) is always fetched (useInstructors passes includeArchived:
  // true) so this toggle/count never needs a second request.
  const [showArchived, setShowArchived] = useState(false);
  // Archive asks first (Decision 311, I12); Unarchive needs no confirmation.
  const [confirmingArchive, setConfirmingArchive] = useState<InstructorResponse | null>(null);
  // Roster search and filters, all on the already-loaded list (Decision 312, F1).
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [styleFilter, setStyleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // The person in the right-hand panel (the first row until one is picked).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Only the School's owner manages instructors; anyone else who opens this
  // page goes to their own start page instead of a blank one (Decision 311, I11).
  if (!schoolId) return <Navigate to="/" replace />;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('instructors.loadFailed')} />;

  const allInstructors = data?.items ?? [];
  const archivedCount = allInstructors.filter((i) => i.archivedAt).length;
  const branches = branchData?.items ?? [];
  const disciplines = disciplineData?.items ?? [];
  const query = search.trim().toLowerCase();
  const instructors = allInstructors.filter(
    (i) =>
      (showArchived || !i.archivedAt) &&
      // Names through the one search fold (Decision 434, TXT-1); the email as typed.
      (!query || matchesNameSearch(i.firstName, i.surname, query) || i.email.toLowerCase().includes(query)) &&
      (!branchFilter || (branchFilter === WHOLE_SCHOOL ? !i.branchId : i.branchId === branchFilter)) &&
      (!styleFilter || i.specializationStyleIds.includes(styleFilter)) &&
      (!statusFilter || (statusFilter === AWAITING ? i.awaitingFirstLogin : i.status === statusFilter)),
  );
  const filtering = !!(query || branchFilter || styleFilter || statusFilter);

  const selected = instructors.find((i) => i.id === selectedId) ?? instructors[0] ?? null;
  const nameOf = (i: InstructorResponse) => `${i.firstName} ${i.surname}`.trim();
  const scopeOf = (i: InstructorResponse) => (i.branchId ? branches.find((b) => b.id === i.branchId)?.name ?? i.branchId : t('instructors.allBranches'));
  // The belts card below picks a person too, by their account.
  const pickByUser = (userId: string) => {
    const match = allInstructors.find((i) => i.userId === userId);
    if (match) setSelectedId(match.id);
  };

  // The panel shows only what the list and the belts card don't (DESIGN.md
  // → "Team member full page": the Coaches Info tab leaves out the belts and
  // "Open full page ›"): the person, Front desk and money, and the way to
  // their Grading permissions.
  const panel = teamPanel(selected ? (
    <>
      <TeamPanelWho firstName={selected.firstName} surname={selected.surname} photoUrl={selected.photoUrl} name={nameOf(selected)} />
      <FrontDeskSwitches schoolId={schoolId} userId={selected.userId} name={nameOf(selected)} />
      <Link className="u8t-pill u8t-panel-button" to="/grading/permissions">
        {t('grading.settings.who.link')}
      </Link>
    </>
  ) : null, t('instructors.team.panelLabel'));

  return (
    <>
      <TeamHeader
        schoolId={schoolId}
        actions={
          <>
            {isMainOwner ? (
              <>
                <button type="button" className="u8t-pill" onClick={() => setInvitingExisting(true)}>
                  {t('instructors.inviteExisting')}
                </button>
                <button type="button" className="u8t-pill" onClick={() => setAddingManually(true)}>
                  {t('instructors.addManually')}
                </button>
              </>
            ) : null}
            <button type="button" className="u8t-pill u8t-pill--go" onClick={() => { setCreatePreset(null); setCreating(true); }}>
              {t('instructors.addInstructor')}
            </button>
          </>
        }
      />
      {addManuallyNotice?.kind === 'ok' ? <SuccessBanner message={addManuallyNotice.text} /> : null}
      {addManuallyNotice?.kind === 'warn' ? <ErrorBanner message={addManuallyNotice.text} /> : null}
      {inviteRoleNotice?.kind === 'ok' ? <SuccessBanner message={inviteRoleNotice.text} /> : null}
      {inviteRoleNotice?.kind === 'warn' ? <ErrorBanner message={inviteRoleNotice.text} /> : null}
      <NewLookPage inspector={panel.inspector} inspectorLabel={t('instructors.team.panelLabel')}>
      <div className="u8t-stack">
      {actionError ? <ErrorBanner message={actionError} /> : null}
      <TeamCard title={t('instructors.title')} intro={isMainOwner === false ? `${t('instructors.subtitle')} ${t('roleGrants.staff.mainOwnerOnly')}` : t('instructors.subtitle')}>
        <div className="u8t-toolbar">
          <TeamSearch id="instructors-search" label={t('instructors.filters.search')} placeholder={t('instructors.filters.searchPlaceholder')} value={search} onChange={setSearch} />
          {branches.length > 0 ? (
            <TeamSelect
              id="instructors-branch-filter"
              label={t('instructors.filters.branch')}
              value={branchFilter}
              onChange={setBranchFilter}
              options={[{ value: '', label: t('instructors.filters.any') }, { value: WHOLE_SCHOOL, label: t('instructors.allBranches') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
            />
          ) : null}
          {disciplines.length > 0 ? (
            <TeamSelect
              id="instructors-style-filter"
              label={t('instructors.filters.style')}
              value={styleFilter}
              onChange={setStyleFilter}
              options={[{ value: '', label: t('instructors.filters.any') }, ...disciplines.map((d) => ({ value: d.id, label: d.name }))]}
            />
          ) : null}
          <TeamSelect
            id="instructors-status-filter"
            label={t('instructors.filters.status')}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: '', label: t('instructors.filters.any') },
              { value: 'ACTIVE', label: t('lib.instructorStatus.active') },
              { value: 'REVOKED', label: t('lib.instructorStatus.revoked') },
              { value: AWAITING, label: t('instructors.awaitingFirstLogin') },
            ]}
          />
          {/* Decision 226 — archived Instructor profiles are hidden by default. */}
          <button type="button" className="u8t-chip" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {archivedCount ? t('instructors.showArchivedCount', { count: archivedCount }) : t('instructors.showArchived')}
          </button>
        </div>
        {instructors.length === 0 && filtering ? (
          <div className="u8t-state">
            <EmptyState title={t('instructors.filters.noMatchTitle')} description={t('instructors.filters.noMatchDescription')} />
          </div>
        ) : instructors.length === 0 ? (
          <div className="u8t-state">
            <EmptyState title={t('instructors.emptyTitle')} description={t('instructors.emptyDescription')} />
          </div>
        ) : (
          <table className="u8t-table">
            <thead>
              <tr>
                <th scope="col">{t('instructors.columnInstructor')}</th>
                <th scope="col">{t('instructors.columnSpecializations')}</th>
                <th scope="col">{t('instructors.columnScope')}</th>
                <th scope="col">{t('instructors.columnPhone')}</th>
                <th scope="col">{t('instructors.columnStatus')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {instructors.map((i) => (
                <tr key={i.id} {...pickRow(selected?.id === i.id, () => setSelectedId(i.id))}>
                  <td className="u8t-c-main">
                    <div className="u8t-who">
                      <TeamAvatar firstName={i.firstName} surname={i.surname} photoUrl={i.photoUrl} />
                      <div className="u8t-who__text">
                        <button type="button" className="u8t-name" aria-pressed={selected?.id === i.id} onClick={() => { setSelectedId(i.id); showPanel(); }}>
                          {nameOf(i)}
                        </button>
                        {i.archivedAt ? (
                          <>
                            {' '}
                            <span className="u8t-tag">{t('instructors.archived')}</span>
                          </>
                        ) : null}
                        <div>
                          <OpenFullPageLink to={`/instructors/${i.id}`} name={nameOf(i)} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="u8t-k">{t('instructors.columnSpecializations')}: </span>
                    <SpecializationBadges specializations={i.specializations} />
                  </td>
                  <td>
                    <span className="u8t-k">{t('instructors.columnScope')}: </span>
                    {scopeOf(i)}
                  </td>
                  <td>
                    <span className="u8t-k">{t('instructors.columnPhone')}: </span>
                    {i.phone ?? '—'}
                  </td>
                  {/* Whether they still hold the Instructor role here (Decision 311, I7). */}
                  <td className="u8t-c-end">
                    <div className="u8t-tags">
                      <span className={'u8t-tag' + (i.status === 'ACTIVE' ? ' u8t-tag--ok' : '')}>
                        {i.status === 'ACTIVE' ? t('lib.instructorStatus.active') : t('lib.instructorStatus.revoked')}
                      </span>
                      {/* Added manually and still on the temporary passcode (Decision 312). */}
                      {i.awaitingFirstLogin ? <span className="u8t-tag u8t-tag--warn">{t('instructors.awaitingFirstLogin')}</span> : null}
                    </div>
                  </td>
                  <td className="u8t-c-act">
                    <div className="u8t-actions">
                      <button type="button" className="u8t-pill u8t-pill--sm" onClick={() => setEditing(i)}>
                        {t('instructors.edit')}
                      </button>
                      {/* Decision 226 — School Owner/Manager only, idempotent,
                          blocked (409) by an upcoming Class/TimetableSlot
                          assignment. Never touches the underlying User or
                          their INSTRUCTOR RoleGrant. */}
                      <RowActionsMenu
                        label={t('instructors.rowActionsAria', { name: nameOf(i) })}
                        actions={[
                          i.archivedAt
                            ? { label: t('instructors.unarchive'), onClick: () => { setActionError(null); unarchiveInstructor.mutate(i.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : t('instructors.unarchiveFailed')) }); } }
                            : { label: t('instructors.archive'), onClick: () => { setActionError(null); setConfirmingArchive(i); } },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TeamCard>
      {panel.underList}

      <InstructorBeltsSection
        schoolId={schoolId}
        selectedUserId={selected?.userId ?? null}
        onPick={pickByUser}
        profileOf={(userId) => allInstructors.find((i) => i.userId === userId) ?? null}
      />
      </div>
      </NewLookPage>

      {confirmingArchive ? (
        <ConfirmDeleteModal
          title={t('instructors.archiveTitle', { name: `${confirmingArchive.firstName} ${confirmingArchive.surname}`.trim() })}
          description={t('instructors.archiveDescription')}
          confirmLabel={t('instructors.archive')}
          genericErrorMessage={t('instructors.archiveFailed')}
          onConfirm={() => archiveInstructor.mutateAsync(confirmingArchive.id)}
          onClose={() => setConfirmingArchive(null)}
        />
      ) : null}

      {creating ? (
        <InstructorFormModal
          title={t('instructors.addInstructor')}
          schoolId={schoolId}
          initial={createPreset ?? undefined}
          branches={branches}
          disciplines={disciplines}
          eligibleUsers={eligibleUsersData?.items ?? []}
          submitting={createInstructor.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's nulls back to
            // undefined (omitted), since CreateInstructorDto doesn't accept
            // null on these fields.
            await createInstructor.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditInstructorModal schoolId={schoolId} branches={branches} disciplines={disciplines} instructor={editing} onClose={() => setEditing(null)} />
      ) : null}

      {addingManually ? (
        <AddInstructorManuallyModal
          branches={branches}
          submitting={createInstructorManually.isPending}
          onSubmit={async (values) => {
            const created = await createInstructorManually.mutateAsync(values);
            setAddManuallyNotice(
              created.emailSent
                ? { kind: 'ok', text: t('instructors.addedEmailSent', { name: `${created.firstName} ${created.surname}`, email: created.email }) }
                : { kind: 'warn', text: t('instructors.addedEmailFailed', { name: `${created.firstName} ${created.surname}` }) },
            );
            setAddingManually(false);
          }}
          onClose={() => setAddingManually(false)}
        />
      ) : null}

      {invitingExisting && schoolId ? (
        <InviteToInstructorRoleModal
          schoolId={schoolId}
          branches={branches}
          submitting={inviteToInstructorRole.isPending}
          onSubmit={async ({ targetUserId, email, branchId }) => {
            const granted = await inviteToInstructorRole.mutateAsync({
              targetUserId,
              email,
              body: { role: 'INSTRUCTOR', schoolId, branchId },
            });
            // Decision 396: the School asks new staff to accept first, so an
            // invite went out instead; the profile comes after they accept.
            if (granted.invited) {
              setInviteRoleNotice(
                granted.emailSent
                  ? { kind: 'ok', text: t('instructors.roleInviteSent') }
                  : { kind: 'warn', text: t('instructors.roleInviteEmailFailed') },
              );
              setInvitingExisting(false);
              return;
            }
            // The role grant alone doesn't create an Instructor profile (a
            // deliberately separate concern — see InstructorsService.create()'s
            // own header comment) — point the owner at "Add instructor" next,
            // where this user now shows up as an eligible candidate.
            await queryClient.invalidateQueries({ queryKey: ['instructors', 'eligible-users', schoolId] });
            setInviteRoleNotice(
              granted.emailSent
                ? { kind: 'ok', text: t('instructors.roleGrantedEmailSent') }
                : { kind: 'warn', text: t('instructors.roleGrantedEmailFailed') },
            );
            setInvitingExisting(false);
            setCreatePreset({ userId: targetUserId, branchId: branchId ?? null });
            setCreating(true);
          }}
          onClose={() => setInvitingExisting(false)}
        />
      ) : null}
    </>
  );
}

export function EditInstructorModal({
  schoolId,
  branches,
  disciplines,
  instructor,
  onClose,
}: {
  schoolId: string;
  branches: BranchResponse[];
  disciplines: DisciplineResponse[];
  instructor: InstructorResponse;
  onClose: () => void;
}) {
  const t = useT();
  const updateInstructor = useUpdateInstructor(schoolId, instructor.id);
  return (
    <InstructorFormModal
      title={t('instructors.editInstructor')}
      schoolId={schoolId}
      initial={instructor}
      branches={branches}
      disciplines={disciplines}
      submitting={updateInstructor.isPending}
      onSubmit={async (values) => {
        // Passed straight through, nulls included — UpdateInstructorDto
        // accepts null on these fields to mean "clear it" (see
        // InstructorFormModal's own onSubmit type comment).
        const { userId: _userId, ...updatePayload } = values;
        await updateInstructor.mutateAsync(updatePayload);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
