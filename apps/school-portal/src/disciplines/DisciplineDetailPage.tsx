import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { nullsToUndefined } from '../lib/nullableFields';
import { useDiscipline } from './disciplineQueries';
import { useCreateSkill, useDeleteSkill, useSkills, useUpdateSkill, type SkillResponse } from '../skills/skillQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { SkillFormModal } from '../skills/SkillFormModal';
import { useRanks } from '../ranks/rankQueries';
import { LadderSection } from '../ranks/LadderSection';
import { useT } from '../i18n/I18nProvider';

/** A Discipline's own Skills and Ranks catalog. Reached via a "Manage
 * skills" link from DisciplinesPage's own table — both Skill and Rank CRUD
 * are nested under a Discipline (`/styles/:disciplineId/skills`,
 * `/styles/:disciplineId/ranks`), so there's no School-wide list to build a
 * standalone top-level page against for either. */
export function DisciplineDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const disciplineId = id ?? null;
  const { data: discipline, isLoading: disciplineLoading, error: disciplineError } = useDiscipline(disciplineId);
  const { data: skillData, isLoading: skillsLoading, error: skillsError } = useSkills(disciplineId);
  const { data: rankData, isLoading: ranksLoading, error: ranksError } = useRanks(disciplineId);
  const createSkill = useCreateSkill(disciplineId ?? '');
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillResponse | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<SkillResponse | null>(null);
  const deleteSkill = useDeleteSkill(disciplineId ?? '');

  if (!disciplineId) return null;
  if (disciplineLoading || skillsLoading || ranksLoading) return <Spinner />;
  if (disciplineError) {
    return <ErrorBanner message={disciplineError instanceof ApiError ? disciplineError.message : t('disciplines.detail.loadFailed')} />;
  }
  if (skillsError) {
    return <ErrorBanner message={skillsError instanceof ApiError ? skillsError.message : t('disciplines.detail.skillsLoadFailed')} />;
  }
  if (ranksError) {
    return <ErrorBanner message={ranksError instanceof ApiError ? ranksError.message : t('disciplines.detail.ranksLoadFailed')} />;
  }

  const skills = skillData?.items ?? [];
  const ranks = rankData?.items ?? [];

  return (
    <>
      <PageHeader
        title={discipline?.name ?? t('disciplines.detail.fallbackTitle')}
        subtitle={discipline?.classTypesOffered.length ? discipline.classTypesOffered.join(', ') : undefined}
      />

      <div style={{ marginBottom: 24 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 4 }}>
                {t('disciplines.detail.skillsHeading')}
              </h2>
              <p style={{ margin: 0 }}>{t('disciplines.detail.skillsIntro')}</p>
            </div>
            <Button onClick={() => setCreatingSkill(true)}>{t('disciplines.detail.addSkill')}</Button>
          </div>
          {skills.length === 0 ? (
            <EmptyState title={t('disciplines.detail.emptyTitle')} description={t('disciplines.detail.emptyDescription')} />
          ) : (
            <Table<SkillResponse>
              rows={skills}
              columns={[
                { key: 'name', header: t('disciplines.detail.columnName'), render: (s) => s.name },
                { key: 'description', header: t('disciplines.detail.columnDescription'), render: (s) => s.description ?? '—' },
                {
                  key: 'actions',
                  header: '',
                  render: (s) => (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="secondary" onClick={() => setEditingSkill(s)}>
                        {t('disciplines.detail.edit')}
                      </Button>
                      <Button variant="secondary" onClick={() => setDeletingSkill(s)} aria-label={t('disciplines.detail.deleteAria', { name: s.name })}>
                        {t('disciplines.detail.delete')}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Card>
      </div>

      {discipline ? <LadderSection discipline={discipline} skills={skills} ranks={ranks} /> : null}

      {creatingSkill ? (
        <SkillFormModal
          title={t('disciplines.detail.addSkillTitle')}
          submitting={createSkill.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's null back to
            // undefined (omitted), since CreateSkillDto doesn't accept null.
            await createSkill.mutateAsync(nullsToUndefined(values));
            setCreatingSkill(false);
          }}
          onClose={() => setCreatingSkill(false)}
        />
      ) : null}

      {deletingSkill ? (
        <ConfirmDeleteModal
          title={t('disciplines.detail.deleteTitle', { name: deletingSkill.name })}
          description={t('disciplines.detail.deleteDescription')}
          onConfirm={() => deleteSkill.mutateAsync(deletingSkill.id)}
          onClose={() => setDeletingSkill(null)}
        />
      ) : null}

      {editingSkill ? (
        <EditSkillModal disciplineId={disciplineId} skill={editingSkill} onClose={() => setEditingSkill(null)} />
      ) : null}

    </>
  );
}

function EditSkillModal({ disciplineId, skill, onClose }: { disciplineId: string; skill: SkillResponse; onClose: () => void }) {
  const t = useT();
  const updateSkill = useUpdateSkill(disciplineId, skill.id);
  return (
    <SkillFormModal
      title={t('disciplines.detail.editSkillTitle')}
      initial={skill}
      submitting={updateSkill.isPending}
      onSubmit={async (values) => {
        // Passed straight through, null included — UpdateSkillDto accepts
        // null on description to mean "clear it".
        await updateSkill.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
