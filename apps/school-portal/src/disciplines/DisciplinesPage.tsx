import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Checkbox, EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import {
  useCreateDiscipline,
  useDeleteDiscipline,
  useDisciplines,
  useSetDisciplineArchived,
  useUpdateDiscipline,
  useCanManageDisciplines,
  type DisciplineResponse,
} from './disciplineQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { DisciplineFormModal } from './DisciplineFormModal';
import { DuplicateModal, TemplateModal } from './StyleTemplateModals';
import { useGradingHeaderTabs } from '../grading/GradingTabs';
import { useT } from '../i18n/I18nProvider';
import { BillingCard, BillingPage } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { FitTable } from '../students/StudentsSectionLook';
import './stylesLook.css';

/** Disciplines are reference data Instructors' specializations and Classes'/
 * TimetableSlots' activities are conceptually drawn from (domain-rules §4 —
 * "discipline" and the DTOs' own free-text "activities" fields are the same
 * concept, not formally reconciled into one shared enum) — managed here first,
 * since Instructors/Classes/Timetable have nothing to reference otherwise.
 *
 * Decision 309: the owner edits; coaches and Branch Staff see the same page
 * read-only, so they can check what each belt needs. Archived styles are
 * hidden behind "Show archived". Decision 383: Branch Staff the owner ticked
 * "Can manage disciplines" for edit it too, and an archived style nobody uses
 * can be deleted permanently.
 *
 * New look (Decision 460): the new page header with the Grading tabs, a white
 * card, and a table that becomes cards when it doesn't fit. Same columns,
 * buttons and checks as before. */
export function DisciplinesPage() {
  const navigate = useNavigate();
  const t = useT();
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  const schoolId = ownedSchoolId ?? coachSchoolId;
  const canEdit = useCanManageDisciplines(schoolId);
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error } = useDisciplines(schoolId, { includeArchived: showArchived });
  const createDiscipline = useCreateDiscipline(schoolId ?? '');
  const setArchived = useSetDisciplineArchived(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DisciplineResponse | null>(null);
  const [fromTemplate, setFromTemplate] = useState(false);
  const [duplicating, setDuplicating] = useState<DisciplineResponse | null>(null);
  const [deleting, setDeleting] = useState<DisciplineResponse | null>(null);
  const [archiving, setArchiving] = useState<DisciplineResponse | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const deleteDiscipline = useDeleteDiscipline(schoolId ?? '');
  const headerTabs = useGradingHeaderTabs();

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('disciplines.list.loadFailed')} />;

  const disciplines = data?.items ?? [];

  async function unarchive(d: DisciplineResponse) {
    setRowError(null);
    try {
      await setArchived.mutateAsync({ id: d.id, archived: false });
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <BillingPage>
      <NewLookPageHeader
        title={t('disciplines.list.title')}
        subtitle={canEdit ? t('disciplines.list.subtitle') : t('disciplines.list.readOnlySubtitle')}
        actions={
          canEdit ? (
            <>
              <Button variant="secondary" onClick={() => setFromTemplate(true)}>
                {t('disciplines.list.startFromTemplate')}
              </Button>
              <Button onClick={() => setCreating(true)}>{t('disciplines.list.addButton')}</Button>
            </>
          ) : undefined
        }
        {...headerTabs}
      />
      <BillingCard>
        <div className="u8gs-filter">
          <Checkbox label={t('disciplines.list.showArchived')} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        </div>
        {rowError ? <ErrorBanner message={rowError} /> : null}
        {disciplines.length === 0 ? (
          <EmptyState title={t('disciplines.list.emptyTitle')} description={t('disciplines.list.emptyDescription')} />
        ) : (
          <FitTable<DisciplineResponse>
            rows={disciplines}
            columns={[
              {
                key: 'name',
                header: t('disciplines.list.columnName'),
                main: true,
                render: (d) => (
                  <span className="u8gs-name">
                    <span className="u8b-name">{d.name}</span>
                    {d.archivedAt ? <span className="u8gs-tag">{t('disciplines.list.archived')}</span> : null}
                  </span>
                ),
              },
              { key: 'classTypes', header: t('disciplines.list.columnClassTypes'), render: (d) => d.classTypesOffered.join(', ') || '—' },
              { key: 'students', header: t('disciplines.list.columnStudents'), render: (d) => String(d.studentCount) },
              {
                key: 'actions',
                header: '',
                render: (d) => (
                  <div className="u8gs-actions">
                    <Button variant="secondary" className="u8b-pill--row" onClick={() => navigate(`/disciplines/${d.id}`)} aria-label={t('disciplines.list.openAria', { name: d.name })}>
                      {t('disciplines.list.manageSkills')}
                    </Button>
                    {canEdit && !d.archivedAt ? (
                      <>
                        <Button variant="secondary" className="u8b-pill--row" onClick={() => setEditing(d)}>
                          {t('disciplines.list.edit')}
                        </Button>
                        <Button variant="secondary" className="u8b-pill--row" onClick={() => setDuplicating(d)}>
                          {t('disciplines.list.duplicate')}
                        </Button>
                        <Button variant="secondary" className="u8b-pill--row" onClick={() => setArchiving(d)} aria-label={t('disciplines.list.archiveAria', { name: d.name })}>
                          {t('disciplines.list.archive')}
                        </Button>
                      </>
                    ) : null}
                    {canEdit && d.archivedAt ? (
                      <Button variant="secondary" className="u8b-pill--row" onClick={() => void unarchive(d)} aria-label={t('disciplines.list.unarchiveAria', { name: d.name })}>
                        {t('disciplines.list.unarchive')}
                      </Button>
                    ) : null}
                    {canEdit ? (
                      <Button variant="secondary" className="u8b-pill--row" onClick={() => setDeleting(d)} aria-label={t('disciplines.list.deleteAria', { name: d.name })}>
                        {d.archivedAt ? t('disciplines.list.deletePermanently') : t('disciplines.list.delete')}
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )}
      </BillingCard>

      {creating ? (
        <DisciplineFormModal
          title={t('disciplines.list.addTitle')}
          submitting={createDiscipline.isPending}
          onSubmit={async ({ renameClassTypes: _renames, ...values }) => {
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

      {archiving ? (
        <ConfirmDeleteModal
          title={t('disciplines.list.archiveTitle', { name: archiving.name })}
          description={t('disciplines.list.archiveDescription')}
          confirmLabel={t('disciplines.list.archive')}
          genericErrorMessage={t('disciplines.list.archiveFailed')}
          onConfirm={() => setArchived.mutateAsync({ id: archiving.id, archived: true })}
          onClose={() => setArchiving(null)}
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
        <EditDisciplineModal schoolId={schoolId} discipline={editing} styles={disciplines} onClose={() => setEditing(null)} />
      ) : null}
    </BillingPage>
  );
}

function EditDisciplineModal({
  schoolId,
  discipline,
  styles,
  onClose,
}: {
  schoolId: string;
  discipline: DisciplineResponse;
  styles: DisciplineResponse[];
  onClose: () => void;
}) {
  const t = useT();
  const updateDiscipline = useUpdateDiscipline(schoolId, discipline.id);
  // Backlog 3.20: a Kids style links to an Adult style; one level only.
  const isAdultOfAnother = styles.some((d) => d.adultDisciplineId === discipline.id);
  const adultChoices = isAdultOfAnother ? null : styles.filter((d) => d.id !== discipline.id && !d.archivedAt && !d.adultDisciplineId);
  return (
    <DisciplineFormModal
      title={t('disciplines.list.editTitle')}
      initial={discipline}
      adultChoices={adultChoices}
      submitting={updateDiscipline.isPending}
      onSubmit={async (values) => {
        await updateDiscipline.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
