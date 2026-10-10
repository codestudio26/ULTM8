import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useCreateDiscipline, useDeleteDiscipline, useDisciplines, useUpdateDiscipline, type DisciplineResponse } from './disciplineQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { DisciplineFormModal } from './DisciplineFormModal';
import { DuplicateModal, TemplateModal } from './StyleTemplateModals';

/** Disciplines are reference data Instructors' specializations and Classes'/
 * TimetableSlots' activities are conceptually drawn from (domain-rules §4 —
 * "discipline" and the DTOs' own free-text "activities" fields are the same
 * concept, not formally reconciled into one shared enum) — managed here first,
 * since Instructors/Classes/Timetable have nothing to reference otherwise. */
export function DisciplinesPage() {
  const navigate = useNavigate();
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useDisciplines(schoolId);
  const createDiscipline = useCreateDiscipline(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DisciplineResponse | null>(null);
  const [fromTemplate, setFromTemplate] = useState(false);
  const [duplicating, setDuplicating] = useState<DisciplineResponse | null>(null);
  const [deleting, setDeleting] = useState<DisciplineResponse | null>(null);
  const deleteDiscipline = useDeleteDiscipline(schoolId ?? '');

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Disciplines.'} />;

  const disciplines = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Disciplines"
        subtitle="The martial arts / activities your School offers — Instructors and Classes both reference these."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => setFromTemplate(true)}>
              Start from template
            </Button>
            <Button onClick={() => setCreating(true)}>Add discipline</Button>
          </div>
        }
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
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" onClick={() => navigate(`/disciplines/${d.id}`)}>
                      Manage skills
                    </Button>
                    <Button variant="secondary" onClick={() => setEditing(d)}>
                      Edit
                    </Button>
                    <Button variant="secondary" onClick={() => setDuplicating(d)}>
                      Duplicate
                    </Button>
                    <Button variant="secondary" onClick={() => setDeleting(d)} aria-label={`Delete ${d.name}`}>
                      Delete
                    </Button>
                  </div>
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

      {fromTemplate ? (
        <TemplateModal schoolId={schoolId} onCreated={(id) => navigate(`/disciplines/${id}`)} onClose={() => setFromTemplate(false)} />
      ) : null}

      {deleting ? (
        <ConfirmDeleteModal
          title={`Delete ${deleting.name}?`}
          description="Its belts, skills and coach permissions are deleted with it. A style can only be deleted while nobody has a rank in it and no class or lesson uses it."
          onConfirm={() => deleteDiscipline.mutateAsync(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {duplicating ? (
        <DuplicateModal
          schoolId={schoolId}
          discipline={duplicating}
          onCreated={(id) => navigate(`/disciplines/${id}`)}
          onClose={() => setDuplicating(null)}
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
