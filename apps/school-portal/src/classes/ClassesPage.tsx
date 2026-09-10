import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { useInstructors, type InstructorResponse } from '../instructors/instructorQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { useClasses, useCreateClass, useUpdateClass, type ClassResponse } from './classQueries';
import { ClassFormModal } from './ClassFormModal';

export function ClassesPage() {
  const navigate = useNavigate();
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useClasses(schoolId);
  const { data: branchData } = useBranches(schoolId);
  const { data: instructorData } = useInstructors(schoolId);
  const createClass = useCreateClass(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClassResponse | null>(null);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Classes.'} />;

  const classes = data?.items ?? [];
  const branches = branchData?.items ?? [];
  const instructors = instructorData?.items ?? [];

  return (
    <>
      <PageHeader
        title="Classes"
        subtitle="One-off and recurring Classes Students can book into."
        actions={<Button onClick={() => setCreating(true)}>Add class</Button>}
      />
      <Card>
        {classes.length === 0 ? (
          <EmptyState title="No Classes yet" description="Add your first Class to get started." />
        ) : (
          <Table<ClassResponse>
            rows={classes}
            columns={[
              { key: 'title', header: 'Title', render: (c) => c.title },
              {
                key: 'activities',
                header: 'Activities',
                // Index-qualified key — activities is unconstrained free text
                // (no dedup enforced), so two identical entries would
                // otherwise collide on the same key.
                render: (c) => c.activities.map((a, i) => <Badge key={`${a}-${i}`}>{a}</Badge>),
              },
              { key: 'start', header: 'Starts', render: (c) => new Date(c.startDate).toLocaleString() },
              { key: 'end', header: 'Ends', render: (c) => new Date(c.endDate).toLocaleString() },
              { key: 'capacity', header: 'Capacity', render: (c) => c.capacity ?? 'Unlimited' },
              {
                key: 'branch',
                header: 'Branch',
                render: (c) => branches.find((b) => b.id === c.branchId)?.name ?? (c.branchId ? c.branchId : 'Whole School'),
              },
              {
                key: 'actions',
                header: '',
                render: (c) => (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" onClick={() => navigate(`/classes/${c.id}`)}>
                      View bookings
                    </Button>
                    <Button variant="secondary" onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      {creating ? (
        <ClassFormModal
          title="Add class"
          branches={branches}
          instructors={instructors}
          submitting={createClass.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's nulls back to
            // undefined (omitted), since CreateClassDto doesn't accept null.
            await createClass.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditClassModal
          schoolId={schoolId}
          branches={branches}
          instructors={instructors}
          classItem={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function EditClassModal({
  schoolId,
  branches,
  instructors,
  classItem,
  onClose,
}: {
  schoolId: string;
  branches: BranchResponse[];
  instructors: InstructorResponse[];
  classItem: ClassResponse;
  onClose: () => void;
}) {
  const updateClass = useUpdateClass(schoolId, classItem.id);
  return (
    <ClassFormModal
      title="Edit class"
      initial={classItem}
      branches={branches}
      instructors={instructors}
      submitting={updateClass.isPending}
      onSubmit={async (values) => {
        // Passed straight through, nulls included — UpdateClassDto accepts
        // null on these fields to mean "clear it" (see ClassFormValues' own
        // header comment).
        await updateClass.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
