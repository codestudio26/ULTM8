import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useCreateDiscipline, useDeleteDiscipline, useDisciplines, useUpdateDiscipline, type DisciplineResponse } from './disciplineQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { DisciplineFormModal } from './DisciplineFormModal';
import { DuplicateModal, TemplateModal } from './StyleTemplateModals';
import { useT } from '../i18n/I18nProvider';

/** Disciplines are reference data Instructors' specializations and Classes'/
 * TimetableSlots' activities are conceptually drawn from (domain-rules §4 —
 * "discipline" and the DTOs' own free-text "activities" fields are the same
 * concept, not formally reconciled into one shared enum) — managed here first,
 * since Instructors/Classes/Timetable have nothing to reference otherwise. */
export function DisciplinesPage() {
  const navigate = useNavigate();
  const t = useT();
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
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('disciplines.list.loadFailed')} />;

  const disciplines = data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('disciplines.list.title')}
        subtitle={t('disciplines.list.subtitle')}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => setFromTemplate(true)}>
              {t('disciplines.list.startFromTemplate')}
            </Button>
            <Button onClick={() => setCreating(true)}>{t('disciplines.list.addButton')}</Button>
          </div>
        }
      />
      <Card>
        {disciplines.length === 0 ? (
          <EmptyState title={t('disciplines.list.emptyTitle')} description={t('disciplines.list.emptyDescription')} />
        ) : (
          <Table<DisciplineResponse>
            rows={disciplines}
            columns={[
              { key: 'name', header: t('disciplines.list.columnName'), render: (d) => d.name },
              { key: 'classTypes', header: t('disciplines.list.columnClassTypes'), render: (d) => d.classTypesOffered.join(', ') || '—' },
              {
                key: 'actions',
                header: '',
                render: (d) => (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" onClick={() => navigate(`/disciplines/${d.id}`)}>
                      {t('disciplines.list.manageSkills')}
                    </Button>
                    <Button variant="secondary" onClick={() => setEditing(d)}>
                      {t('disciplines.list.edit')}
                    </Button>
                    <Button variant="secondary" onClick={() => setDuplicating(d)}>
                      {t('disciplines.list.duplicate')}
                    </Button>
                    <Button variant="secondary" onClick={() => setDeleting(d)} aria-label={t('disciplines.list.deleteAria', { name: d.name })}>
                      {t('disciplines.list.delete')}
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
          title={t('disciplines.list.addTitle')}
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
          title={t('disciplines.list.deleteTitle', { name: deleting.name })}
          description={t('disciplines.list.deleteDescription')}
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
  const t = useT();
  const updateDiscipline = useUpdateDiscipline(schoolId, discipline.id);
  return (
    <DisciplineFormModal
      title={t('disciplines.list.editTitle')}
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
