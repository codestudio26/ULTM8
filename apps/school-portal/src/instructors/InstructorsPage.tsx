import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { useCreateInstructor, useInstructors, useUpdateInstructor, type InstructorResponse } from './instructorQueries';
import { InstructorFormModal } from './InstructorFormModal';

export function InstructorsPage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useInstructors(schoolId);
  const { data: branchData } = useBranches(schoolId);
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
              { key: 'belt', header: 'Belt / ranking', render: (i) => i.beltRanking ?? '—' },
              {
                key: 'specializations',
                header: 'Specializations',
                render: (i) =>
                  i.specializations.length ? i.specializations.map((s, idx) => <Badge key={`${s}-${idx}`}>{s}</Badge>) : '—',
              },
              { key: 'phone', header: 'Phone', render: (i) => i.phone ?? '—' },
              { key: 'experience', header: 'Years exp.', render: (i) => i.yearsOfExperience ?? '—' },
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
