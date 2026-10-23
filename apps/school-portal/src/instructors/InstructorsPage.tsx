import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, PageHeader, RowActionsMenu, SelectField, Spinner, SuccessBanner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { Avatar } from '../lib/Avatar';
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
import { InstructorBeltsSection } from './InstructorBeltsSection';
import { useT } from '../i18n/I18nProvider';

/** Up to 3 specialization badges, then a "+N" overflow badge — keeps a long
 * specializations list from blowing out the row height instead of silently
 * dropping data (every specialization is still in the Edit form). */
function SpecializationBadges({ specializations }: { specializations: string[] }) {
  if (!specializations.length) return <>—</>;
  const shown = specializations.slice(0, 3);
  const overflow = specializations.length - shown.length;
  return (
    <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 6, alignItems: 'center' }}>
      {shown.map((s, idx) => (
        <Badge key={`${s}-${idx}`}>{s}</Badge>
      ))}
      {overflow > 0 ? <Badge>+{overflow}</Badge> : null}
    </div>
  );
}

/** The Branch filter's "whole School" choice (profiles with no branch). */
const WHOLE_SCHOOL = '__whole-school__';
/** Status filter value for "Hasn't signed in yet" (Decision 312). */
const AWAITING = '__awaiting__';

export function InstructorsPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useInstructors(schoolId);
  const { data: branchData } = useBranches(schoolId);
  const { data: disciplineData } = useDisciplines(schoolId);
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
      (!query || `${i.firstName} ${i.surname} ${i.email}`.toLowerCase().includes(query)) &&
      (!branchFilter || (branchFilter === WHOLE_SCHOOL ? !i.branchId : i.branchId === branchFilter)) &&
      (!styleFilter || i.specializationStyleIds.includes(styleFilter)) &&
      (!statusFilter || (statusFilter === AWAITING ? i.awaitingFirstLogin : i.status === statusFilter)),
  );
  const filtering = !!(query || branchFilter || styleFilter || statusFilter);

  return (
    <>
      {addManuallyNotice?.kind === 'ok' ? <SuccessBanner message={addManuallyNotice.text} /> : null}
      {addManuallyNotice?.kind === 'warn' ? <ErrorBanner message={addManuallyNotice.text} /> : null}
      {inviteRoleNotice?.kind === 'ok' ? <SuccessBanner message={inviteRoleNotice.text} /> : null}
      {inviteRoleNotice?.kind === 'warn' ? <ErrorBanner message={inviteRoleNotice.text} /> : null}
      <PageHeader
        title={t('instructors.title')}
        subtitle={t('instructors.subtitle')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setInvitingExisting(true)}>
              {t('instructors.inviteExisting')}
            </Button>
            <Button variant="secondary" onClick={() => setAddingManually(true)}>
              {t('instructors.addManually')}
            </Button>
            <Button onClick={() => { setCreatePreset(null); setCreating(true); }}>{t('instructors.addInstructor')}</Button>
          </>
        }
      />
      {actionError ? <ErrorBanner message={actionError} /> : null}
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 200 }}>
              <Field label={t('instructors.filters.search')} htmlFor="instructors-search">
                <TextField id="instructors-search" type="search" placeholder={t('instructors.filters.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
            </div>
            {branches.length > 0 ? (
              <div style={{ minWidth: 160 }}>
                <Field label={t('instructors.filters.branch')} htmlFor="instructors-branch-filter">
                  <SelectField
                    id="instructors-branch-filter"
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    options={[{ value: '', label: t('instructors.filters.any') }, { value: WHOLE_SCHOOL, label: t('instructors.allBranches') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                  />
                </Field>
              </div>
            ) : null}
            {disciplines.length > 0 ? (
              <div style={{ minWidth: 160 }}>
                <Field label={t('instructors.filters.style')} htmlFor="instructors-style-filter">
                  <SelectField
                    id="instructors-style-filter"
                    value={styleFilter}
                    onChange={(e) => setStyleFilter(e.target.value)}
                    options={[{ value: '', label: t('instructors.filters.any') }, ...disciplines.map((d) => ({ value: d.id, label: d.name }))]}
                  />
                </Field>
              </div>
            ) : null}
            <div style={{ minWidth: 140 }}>
              <Field label={t('instructors.filters.status')} htmlFor="instructors-status-filter">
                <SelectField
                  id="instructors-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  options={[
                    { value: '', label: t('instructors.filters.any') },
                    { value: 'ACTIVE', label: t('lib.instructorStatus.active') },
                    { value: 'REVOKED', label: t('lib.instructorStatus.revoked') },
                    { value: AWAITING, label: t('instructors.awaitingFirstLogin') },
                  ]}
                />
              </Field>
            </div>
          </div>
          {/* Decision 226 — archived Instructor profiles are hidden by default. */}
          <Checkbox label={archivedCount ? t('instructors.showArchivedCount', { count: archivedCount }) : t('instructors.showArchived')} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        </div>
        {instructors.length === 0 && filtering ? (
          <EmptyState title={t('instructors.filters.noMatchTitle')} description={t('instructors.filters.noMatchDescription')} />
        ) : instructors.length === 0 ? (
          <EmptyState
            title={t('instructors.emptyTitle')}
            description={t('instructors.emptyDescription')}
          />
        ) : (
          <Table<InstructorResponse>
            rows={instructors}
            columns={[
              {
                key: 'image',
                header: t('instructors.columnImage'),
                render: (i) => <Avatar firstName={i.firstName} surname={i.surname} photoUrl={i.photoUrl} />,
              },
              { key: 'name', header: t('instructors.columnInstructor'), render: (i) => (<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{`${i.firstName} ${i.surname}`.trim()}{i.archivedAt ? <Badge variant="default">{t('instructors.archived')}</Badge> : null}</div>) },
              {
                key: 'specializations',
                header: t('instructors.columnSpecializations'),
                render: (i) => <SpecializationBadges specializations={i.specializations} />,
              },
              {
                key: 'scope',
                header: t('instructors.columnScope'),
                render: (i) => (i.branchId ? branches.find((b) => b.id === i.branchId)?.name ?? i.branchId : t('instructors.allBranches')),
              },
              { key: 'phone', header: t('instructors.columnPhone'), render: (i) => i.phone ?? '—' },
              // Whether they still hold the Instructor role here (Decision 311, I7).
              {
                key: 'status',
                header: t('instructors.columnStatus'),
                render: (i) => (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Badge variant={i.status === 'ACTIVE' ? 'success' : undefined}>
                      {i.status === 'ACTIVE' ? t('lib.instructorStatus.active') : t('lib.instructorStatus.revoked')}
                    </Badge>
                    {/* Added manually and still on the temporary passcode (Decision 312). */}
                    {i.awaitingFirstLogin ? <Badge>{t('instructors.awaitingFirstLogin')}</Badge> : null}
                  </div>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (i) => (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" onClick={() => navigate(`/instructors/${i.id}`)}>
                      {t('instructors.view')}
                    </Button>
                    <Button variant="secondary" onClick={() => setEditing(i)}>
                      {t('instructors.edit')}
                    </Button>
                    {/* Decision 226 — School Owner/Manager only, idempotent,
                        blocked (409) by an upcoming Class/TimetableSlot
                        assignment. Never touches the underlying User or
                        their INSTRUCTOR RoleGrant. */}
                    <RowActionsMenu
                      label={t('instructors.rowActionsAria', { name: `${i.firstName} ${i.surname}`.trim() })}
                      actions={[
                        i.archivedAt
                          ? { label: t('instructors.unarchive'), onClick: () => { setActionError(null); unarchiveInstructor.mutate(i.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : t('instructors.unarchiveFailed')) }); } }
                          : { label: t('instructors.archive'), onClick: () => { setActionError(null); setConfirmingArchive(i); } },
                      ]}
                    />
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      <InstructorBeltsSection schoolId={schoolId} />

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
          onSubmit={async ({ targetUserId, branchId }) => {
            const granted = await inviteToInstructorRole.mutateAsync({
              targetUserId,
              body: { role: 'INSTRUCTOR', schoolId, branchId },
            });
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

function EditInstructorModal({
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
