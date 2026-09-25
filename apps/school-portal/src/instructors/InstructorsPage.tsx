import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import {
  useCreateInstructor,
  useEligibleInstructorUsers,
  useInstructors,
  useUpdateInstructor,
  type InstructorResponse,
} from './instructorQueries';
import { InstructorFormModal } from './InstructorFormModal';

/** Generic silhouette placeholder — InstructorResponseDto.photoUrl is real and
 * nullable, but no upload UI exists yet anywhere in this app, so every row is
 * always this icon today. An icon for "no photo set" is honest; a stock photo
 * standing in for a specific instructor would not be. */
function AvatarPlaceholder() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'var(--surface-0)',
        border: '1px solid var(--border)',
        color: 'var(--text-muted)',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 17c1.2-3.5 4-5 7-5s5.8 1.5 7 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
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
              { key: 'id', header: 'Id', render: (i) => <code>{i.id.slice(0, 8)}</code> },
              { key: 'image', header: '', render: () => <AvatarPlaceholder /> },
              { key: 'name', header: 'Name', render: (i) => `${i.firstName} ${i.surname}`.trim() },
              { key: 'ranking', header: 'Ranking', render: (i) => i.beltRanking ?? '—' },
              {
                key: 'specializations',
                header: 'Specializations',
                render: (i) =>
                  i.specializations.length ? i.specializations.map((s, idx) => <Badge key={`${s}-${idx}`}>{s}</Badge>) : '—',
              },
              { key: 'experience', header: 'Years exp.', render: (i) => i.yearsOfExperience ?? '—' },
              { key: 'phone', header: 'Phone', render: (i) => i.phone ?? '—' },
              {
                key: 'branch',
                header: 'Branch',
                render: (i) => branches.find((b) => b.id === i.branchId)?.name ?? (i.branchId ? i.branchId : 'Whole School'),
              },
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
