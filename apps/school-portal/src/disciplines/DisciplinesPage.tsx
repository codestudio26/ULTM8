import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { StyleDetail } from './StyleDetail';
import { StyleSwitch } from '../grading/StyleSwitch';
import { useGradingHeaderTabs } from '../grading/GradingTabs';
import { useT } from '../i18n/I18nProvider';
import { BillingCard, BillingPage } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';
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
 * Grading → Styles & Belts in the design's layout (Decision 462 item 9): one
 * style at a time, picked with the style switch. The style card holds the
 * switch and the style's own actions (Edit · Duplicate · Archive · Delete, or
 * Unarchive · Delete permanently), Start from template, Add discipline and
 * Show archived. Under it are the style's Ladder, Skills and (owner) Students,
 * and beside them the "About this style" panel, which turns into the picked
 * belt's panel (StyleDetail). `/disciplines/:id` opens the page on that style.
 * Same actions, fields and permission checks as before. */
export function DisciplinesPage() {
  const navigate = useNavigate();
  const t = useT();
  const { id: routeId } = useParams<{ id: string }>();
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  const schoolId = ownedSchoolId ?? coachSchoolId;
  const canEdit = useCanManageDisciplines(schoolId);
  const [showArchived, setShowArchived] = useState(false);
  // Every style, archived ones too: the switch hides them until "Show archived" is ticked.
  const { data, isLoading, error } = useDisciplines(schoolId, { includeArchived: true });
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

  const all = data?.items ?? [];
  const anyArchived = all.some((d) => d.archivedAt);
  // The style asked for in the address is shown even when archived (a link to it still opens it).
  const shownStyles = all.filter((d) => showArchived || !d.archivedAt || d.id === routeId);
  const style = shownStyles.find((d) => d.id === routeId) ?? shownStyles[0] ?? null;
  const pick = (id: string) => {
    setRowError(null);
    navigate(`/disciplines/${id}`, { replace: true });
  };

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
        {...headerTabs}
      />
      <StyleDetail
        key={style?.id ?? 'none'}
        discipline={style}
        canManage={canEdit}
        styleCard={
          <BillingCard>
            <section aria-label={t('grading.board.styleLabel')} className="u8gs-style-card">
              <div className="u8gs-style-card__row">
                {style ? (
                  <div className="u8gs-style-card__pick">
                    <div className="u8gs-label" aria-hidden="true">
                      {t('grading.board.styleLabel')}
                    </div>
                    <StyleSwitch
                      styles={shownStyles.map((d) => ({ id: d.id, name: d.archivedAt ? `${d.name} · ${t('disciplines.list.archived')}` : d.name }))}
                      value={style.id}
                      onChange={pick}
                    />
                  </div>
                ) : null}
                {canEdit ? (
                  <div className="u8gs-actions">
                    {style && !style.archivedAt ? (
                      <>
                        <Button variant="secondary" className="u8b-pill--row" onClick={() => setEditing(style)}>
                          {t('disciplines.list.edit')}
                        </Button>
                        <Button variant="secondary" className="u8b-pill--row" onClick={() => setDuplicating(style)}>
                          {t('disciplines.list.duplicate')}
                        </Button>
                        <Button variant="secondary" className="u8b-pill--row" onClick={() => setArchiving(style)} aria-label={t('disciplines.list.archiveAria', { name: style.name })}>
                          {t('disciplines.list.archive')}
                        </Button>
                      </>
                    ) : null}
                    {style?.archivedAt ? (
                      <Button variant="secondary" className="u8b-pill--row" onClick={() => void unarchive(style)} aria-label={t('disciplines.list.unarchiveAria', { name: style.name })}>
                        {t('disciplines.list.unarchive')}
                      </Button>
                    ) : null}
                    {style ? (
                      <Button variant="secondary" className="u8b-pill--row" onClick={() => setDeleting(style)} aria-label={t('disciplines.list.deleteAria', { name: style.name })}>
                        {style.archivedAt ? t('disciplines.list.deletePermanently') : t('disciplines.list.delete')}
                      </Button>
                    ) : null}
                    <Button variant="secondary" className="u8b-pill--row" onClick={() => setFromTemplate(true)}>
                      {t('disciplines.list.startFromTemplate')}
                    </Button>
                    <Button className="u8b-pill--row" onClick={() => setCreating(true)}>
                      {t('disciplines.list.addButton')}
                    </Button>
                  </div>
                ) : null}
              </div>
              {anyArchived ? (
                <div className="u8gs-filter">
                  <Checkbox
                    label={t('disciplines.list.showArchived')}
                    checked={showArchived}
                    onChange={(e) => {
                      setShowArchived(e.target.checked);
                      // Hiding archived styles leaves an archived one that was showing.
                      if (!e.target.checked && style?.archivedAt) navigate('/disciplines', { replace: true });
                    }}
                  />
                </div>
              ) : null}
              {style?.archivedAt ? (
                <p className="u8gs-status">
                  <span className="u8gs-tag">{t('disciplines.list.archived')}</span> <span className="u8gs-note">{t('disciplines.detail.archivedNote')}</span>
                </p>
              ) : style && !canEdit ? (
                <p className="u8gs-note">{t('disciplines.detail.readOnlyNote')}</p>
              ) : null}
              {rowError ? <ErrorBanner message={rowError} /> : null}
              {all.length === 0 ? <EmptyState title={t('disciplines.list.emptyTitle')} description={t('disciplines.list.emptyDescription')} /> : null}
            </section>
          </BillingCard>
        }
      />

      {creating ? (
        <DisciplineFormModal
          title={t('disciplines.list.addTitle')}
          submitting={createDiscipline.isPending}
          onSubmit={async ({ renameClassTypes: _renames, ...values }) => {
            const created = await createDiscipline.mutateAsync(values);
            setCreating(false);
            if (created?.id) pick(created.id);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {fromTemplate ? <TemplateModal schoolId={schoolId} onCreated={(id) => navigate(`/disciplines/${id}`)} onClose={() => setFromTemplate(false)} /> : null}

      {deleting ? (
        <ConfirmDeleteModal
          title={t('disciplines.list.deleteTitle', { name: deleting.name })}
          description={t('disciplines.list.deleteDescription')}
          onConfirm={async () => {
            await deleteDiscipline.mutateAsync(deleting.id);
            if (deleting.id === routeId) navigate('/disciplines', { replace: true });
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {archiving ? (
        <ConfirmDeleteModal
          title={t('disciplines.list.archiveTitle', { name: archiving.name })}
          description={t('disciplines.list.archiveDescription')}
          confirmLabel={t('disciplines.list.archive')}
          genericErrorMessage={t('disciplines.list.archiveFailed')}
          onConfirm={async () => {
            await setArchived.mutateAsync({ id: archiving.id, archived: true });
            // It leaves the switch (until "Show archived"), so the page moves to the first style.
            if (!showArchived) navigate('/disciplines', { replace: true });
          }}
          onClose={() => setArchiving(null)}
        />
      ) : null}

      {duplicating ? (
        <DuplicateModal schoolId={schoolId} discipline={duplicating} onCreated={(id) => navigate(`/disciplines/${id}`)} onClose={() => setDuplicating(null)} />
      ) : null}

      {editing ? <EditDisciplineModal schoolId={schoolId} discipline={editing} styles={all} onClose={() => setEditing(null)} /> : null}
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
