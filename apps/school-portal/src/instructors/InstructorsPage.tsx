import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { Avatar } from '../lib/Avatar';
import {
  useCreateInstructor,
  useEligibleInstructorUsers,
  useInstructors,
  useUpdateInstructor,
  type InstructorResponse,
} from './instructorQueries';
import { InstructorFormModal } from './InstructorFormModal';

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
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useInstructors(schoolId);
  const { data: branchData } = useBranches(schoolId);
  const { data: eligibleUsersData } = useEligibleInstructorUsers(schoolId);
  const createInstructor = useCreateInstructor(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InstructorResponse | null>(null);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Instructors.'} />;

  const instructors = data?.items ?? [];
  const branches = branchData?.items ?? [];

  return (
    <>
      <PageHeader
        title="Instructors"
        subtitle="Instructor profiles at your School. The User must already hold an Instructor role — invite them on the Staff page first."
        actions={<Button onClick={() => setCreating(true)}>Add instructor</Button>}
      />
      <Card>
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
              { key: 'name', header: 'Instructor', render: (i) => `${i.firstName} ${i.surname}`.trim() },
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
                  <Button variant="secondary" onClick={() => setEditing(i)}>
                    Edit
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {creating ? (
        <InstructorFormModal
          title="Add instructor"
          branches={branches}
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
        <EditInstructorModal schoolId={schoolId} branches={branches} instructor={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function EditInstructorModal({
  schoolId,
  branches,
  instructor,
  onClose,
}: {
  schoolId: string;
  branches: BranchResponse[];
  instructor: InstructorResponse;
  onClose: () => void;
}) {
  const updateInstructor = useUpdateInstructor(schoolId, instructor.id);
  return (
    <InstructorFormModal
      title="Edit instructor"
      initial={instructor}
      branches={branches}
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
