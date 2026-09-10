import React, { useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useCreateDiscipline, useDisciplines, useUpdateDiscipline, type DisciplineResponse } from './disciplineQueries';
import { DisciplineFormModal } from './DisciplineFormModal';

/** Disciplines are reference data Instructors' specializations and Classes'/
 * TimetableSlots' activities are conceptually drawn from (domain-rules §4 —
 * "discipline" and the DTOs' own free-text "activities" fields are the same
 * concept, not formally reconciled into one shared enum) — managed here first,
 * since Instructors/Classes/Timetable have nothing to reference otherwise. */
export function DisciplinesPage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useDisciplines(schoolId);
  const createDiscipline = useCreateDiscipline(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DisciplineResponse | null>(null);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Disciplines.'} />;

  const disciplines = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Disciplines"
        subtitle="The martial arts / activities your School offers — Instructors and Classes both reference these."
        actions={<Button onClick={() => setCreating(true)}>Add discipline</Button>}
      />
      <Card>
        {disciplines.length === 0 ? (
          <EmptyState title="No Disciplines yet" description="Add your first Discipline to get started." />
        ) : (
          <Table<DisciplineResponse>
            rows={disciplines}
            columns={[
              { key: 'name', header: 'Name', render: (d) => d.name },
              { key: 'classTypes', header: 'Class types offered', render: (d) => d.classTypesOffered.join(', ') || '—' },
              {
                key: 'actions',
                header: '',
                render: (d) => (
                  <Button variant="secondary" onClick={() => setEditing(d)}>
                    Edit
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {creating ? (
        <DisciplineFormModal
          title="Add discipline"
          submitting={createDiscipline.isPending}
          onSubmit={async (values) => {
            await createDiscipline.mutateAsync(values);
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditDisciplineModal schoolId={schoolId} discipline={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function EditDisciplineModal({
  schoolId,
  discipline,
  onClose,
}: {
  schoolId: string;
  discipline: DisciplineResponse;
  onClose: () => void;
}) {
  const updateDiscipline = useUpdateDiscipline(schoolId, discipline.id);
  return (
    <DisciplineFormModal
      title="Edit discipline"
      initial={discipline}
      submitting={updateDiscipline.isPending}
      onSubmit={async (values) => {
        await updateDiscipline.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
