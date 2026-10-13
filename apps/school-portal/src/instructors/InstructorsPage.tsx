import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, PageHeader, RowActionsMenu, Spinner, SuccessBanner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { Avatar } from '../lib/Avatar';
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

export function InstructorsPage() {
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

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Instructors.'} />;

  const allInstructors = data?.items ?? [];
  const archivedCount = allInstructors.filter((i) => i.archivedAt).length;
  const instructors = showArchived ? allInstructors : allInstructors.filter((i) => !i.archivedAt);
  const branches = branchData?.items ?? [];
  const disciplines = disciplineData?.items ?? [];

  return (
    <>
      {addManuallyNotice?.kind === 'ok' ? <SuccessBanner message={addManuallyNotice.text} /> : null}
      {addManuallyNotice?.kind === 'warn' ? <ErrorBanner message={addManuallyNotice.text} /> : null}
      {inviteRoleNotice?.kind === 'ok' ? <SuccessBanner message={inviteRoleNotice.text} /> : null}
      {inviteRoleNotice?.kind === 'warn' ? <ErrorBanner message={inviteRoleNotice.text} /> : null}
      <PageHeader
        title="Instructors"
        subtitle="Instructor profiles at your School. The User must already hold an Instructor role — invite an existing user to the role, or add one manually below."
        actions={
          <>
            <Button variant="secondary" onClick={() => setInvitingExisting(true)}>
              Invite existing user
            </Button>
            <Button variant="secondary" onClick={() => setAddingManually(true)}>
              Add manually
            </Button>
            <Button onClick={() => setCreating(true)}>Add instructor</Button>
          </>
        }
      />
      {actionError ? <ErrorBanner message={actionError} /> : null}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          {/* Decision 226 — archived Instructor profiles are hidden by default. */}
          <Checkbox label={`Show archived${archivedCount ? ` (${archivedCount})` : ''}`} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        </div>
        {instructors.length === 0 ? (
          <EmptyState
            title="No Instructor profiles yet"
            description="Grant someone the Instructor role on the Staff page, then add their profile here."
          />
        ) : (
          <Table<InstructorResponse>
            rows={instructors}
            columns={[
              {
                key: 'image',
                header: 'Image',
                render: (i) => <Avatar firstName={i.firstName} surname={i.surname} photoUrl={i.photoUrl} />,
              },
              { key: 'name', header: 'Instructor', render: (i) => (<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{`${i.firstName} ${i.surname}`.trim()}{i.archivedAt ? <Badge variant="default">Archived</Badge> : null}</div>) },
              {
                key: 'specializations',
                header: 'Specializations',
                render: (i) => <SpecializationBadges specializations={i.specializations} />,
              },
              {
                key: 'scope',
                header: 'Scope',
                render: (i) => (i.branchId ? branches.find((b) => b.id === i.branchId)?.name ?? i.branchId : 'All branches'),
              },
              // No backend concept of an Instructor "login" state exists yet
              // (see the Instructor model's own comment: a profile requires an
              // already-active RoleGrant, granted immediately — there's no
              // pending-invite state to show). Shown as "—" rather than a
              // fabricated status.
              { key: 'login', header: 'Login', render: () => '—' },
              { key: 'phone', header: 'Phone Number', render: (i) => i.phone ?? '—' },
              // RoleGrant.revokedAt (Active/Revoked) isn't resolved onto
              // InstructorResponseDto yet — same "—" placeholder as Login,
              // rather than hardcoding "Active" for every row.
              { key: 'status', header: 'Status', render: () => '—' },
              {
                key: 'actions',
                header: '',
                render: (i) => (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" onClick={() => navigate(`/instructors/${i.id}`)}>
                      View
                    </Button>
                    <Button variant="secondary" onClick={() => setEditing(i)}>
                      Edit
                    </Button>
                    {/* Decision 226 — School Owner/Manager only, idempotent,
                        blocked (409) by an upcoming Class/TimetableSlot
                        assignment. Never touches the underlying User or
                        their INSTRUCTOR RoleGrant. */}
                    <RowActionsMenu
                      label={`Actions for ${i.firstName} ${i.surname}`.trim()}
                      actions={[
                        i.archivedAt
                          ? { label: 'Unarchive', onClick: () => { setActionError(null); unarchiveInstructor.mutate(i.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Could not unarchive this Instructor profile.') }); } }
                          : { label: 'Archive', onClick: () => { setActionError(null); archiveInstructor.mutate(i.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Could not archive this Instructor profile.') }); } },
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

      {creating ? (
        <InstructorFormModal
          title="Add instructor"
          schoolId={schoolId}
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
                ? { kind: 'ok', text: `${created.firstName} ${created.surname} was added — a temporary passcode was emailed to ${created.email}.` }
                : { kind: 'warn', text: `${created.firstName} ${created.surname} was added, but the email couldn't be sent. They'll need the temporary passcode another way.` },
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
            queryClient.invalidateQueries({ queryKey: ['instructors', 'eligible-users', schoolId] });
            setInviteRoleNotice(
              granted.emailSent
                ? { kind: 'ok', text: 'Instructor role granted — they were emailed to let them know. Use "Add instructor" to add their profile.' }
                : { kind: 'warn', text: 'Instructor role granted, but the notification email could not be sent. Use "Add instructor" to add their profile.' },
            );
            setInvitingExisting(false);
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
  const updateInstructor = useUpdateInstructor(schoolId, instructor.id);
  return (
    <InstructorFormModal
      title="Edit instructor"
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
