import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { nullsToUndefined } from '../lib/nullableFields';
import { useOwnedSchoolIds } from '../auth/AuthContext';
import { useCanManageDisciplines, useDiscipline } from './disciplineQueries';
import { useCreateSkill, useDeleteSkill, useReorderSkills, useSkills, useUpdateSkill, type SkillResponse } from '../skills/skillQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { SkillFormModal } from '../skills/SkillFormModal';
import { useRanks, useRungHolders } from '../ranks/rankQueries';
import { LadderSection } from '../ranks/LadderSection';
import { useGradingHeaderTabs } from '../grading/GradingTabs';
import { useT } from '../i18n/I18nProvider';
import { BillingCard, BillingPage } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { FitTable } from '../students/StudentsSectionLook';
import './stylesLook.css';

/** A Discipline's own Skills and Ranks catalog. Reached via a "Manage
 * skills" link from DisciplinesPage's own table — both Skill and Rank CRUD
 * are nested under a Discipline (`/styles/:disciplineId/skills`,
 * `/styles/:disciplineId/ranks`), so there's no School-wide list to build a
 * standalone top-level page against for either.
 *
 * Decision 309: read-only for coaches and Branch Staff, and for everyone
 * while the style is archived. Skills are in the owner's order and show which
 * rungs require them and how many lessons teach them; the owner also sees
 * the students on each belt. Decision 383: Branch Staff the owner ticked "Can
 * manage disciplines" for edit it like the owner, except grade prices, and
 * still don't see the students.
 *
 * New look (Decision 460): the new page header with the Grading tabs, white
 * cards, tags, and tables that become cards when they don't fit. Same
 * content, order buttons and permission checks as before. */
export function DisciplineDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const disciplineId = id ?? null;
  const { data: discipline, isLoading: disciplineLoading, error: disciplineError } = useDiscipline(disciplineId);
  const { data: skillData, isLoading: skillsLoading, error: skillsError } = useSkills(disciplineId);
  const { data: rankData, isLoading: ranksLoading, error: ranksError } = useRanks(disciplineId);
  const ownedSchoolIds = useOwnedSchoolIds();
  const isOwner = !!discipline && ownedSchoolIds.includes(discipline.schoolId);
  const canManage = useCanManageDisciplines(discipline?.schoolId);
  const canEdit = canManage && !discipline?.archivedAt;
  const createSkill = useCreateSkill(disciplineId ?? '');
  const reorderSkills = useReorderSkills(disciplineId ?? '');
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillResponse | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<SkillResponse | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const deleteSkill = useDeleteSkill(disciplineId ?? '');
  const headerTabs = useGradingHeaderTabs();

  const ranks = useMemo(() => rankData?.items ?? [], [rankData]);
  /** Which rungs require each skill, by rung name, in ladder order. */
  const requiredOn = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const rank of [...ranks].sort((a, b) => a.order - b.order)) {
      if (rank.archivedAt) continue;
      for (const tier of [...rank.stripeTiers].sort((a, b) => a.order - b.order)) {
        for (const skillId of tier.requiredSkillIds ?? []) map.set(skillId, [...(map.get(skillId) ?? []), tier.name]);
      }
    }
    return map;
  }, [ranks]);

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

  async function moveSkill(i: number, delta: number) {
    const ids = skills.map((s) => s.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setSkillError(null);
    try {
      await reorderSkills.mutateAsync(ids);
    } catch (err) {
      setSkillError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <BillingPage>
      <NewLookPageHeader
        title={discipline?.name ?? t('disciplines.detail.fallbackTitle')}
        subtitle={discipline?.classTypesOffered.length ? discipline.classTypesOffered.join(', ') : undefined}
        {...headerTabs}
      />
      {discipline?.archivedAt ? (
        <p className="u8gs-status">
          <span className="u8gs-tag">{t('disciplines.list.archived')}</span> <span className="u8gs-note">{t('disciplines.detail.archivedNote')}</span>
        </p>
      ) : !canManage ? (
        <p className="u8gs-note">{t('disciplines.detail.readOnlyNote')}</p>
      ) : null}

      <BillingCard>
        <div className="u8gs-card-head">
          <div>
            <h2 className="u8b-card__title">{t('disciplines.detail.skillsHeading')}</h2>
            <p className="u8b-note">{t('disciplines.detail.skillsIntro')}</p>
          </div>
          {canEdit ? <Button onClick={() => setCreatingSkill(true)}>{t('disciplines.detail.addSkill')}</Button> : null}
        </div>
        {skillError ? <ErrorBanner message={skillError} /> : null}
        {skills.length === 0 ? (
          <EmptyState title={t('disciplines.detail.emptyTitle')} description={t('disciplines.detail.emptyDescription')} />
        ) : (
          <FitTable<SkillResponse>
            rows={skills}
            columns={[
              { key: 'name', header: t('disciplines.detail.columnName'), main: true, render: (s) => <span className="u8b-name">{s.name}</span> },
              { key: 'description', header: t('disciplines.detail.columnDescription'), render: (s) => s.description ?? '—' },
              {
                key: 'requiredOn',
                header: t('disciplines.detail.columnRequiredOn'),
                render: (s) => (requiredOn.get(s.id) ?? []).join(', ') || '—',
              },
              { key: 'lessons', header: t('disciplines.detail.columnLessons'), render: (s) => String(s.lessonCount) },
              {
                key: 'actions',
                header: '',
                render: (s) => {
                  if (!canEdit) return null;
                  const i = skills.findIndex((x) => x.id === s.id);
                  return (
                    <div className="u8gs-actions">
                      <Button variant="secondary" className="u8b-pill--row" onClick={() => void moveSkill(i, -1)} disabled={i === 0 || reorderSkills.isPending} aria-label={t('disciplines.detail.moveUpAria', { name: s.name })}>
                        ↑
                      </Button>
                      <Button
                        variant="secondary"
                        className="u8b-pill--row"
                        onClick={() => void moveSkill(i, 1)}
                        disabled={i === skills.length - 1 || reorderSkills.isPending}
                        aria-label={t('disciplines.detail.moveDownAria', { name: s.name })}
                      >
                        ↓
                      </Button>
                      <Button variant="secondary" className="u8b-pill--row" onClick={() => setEditingSkill(s)}>
                        {t('disciplines.detail.edit')}
                      </Button>
                      <Button variant="secondary" className="u8b-pill--row" onClick={() => setDeletingSkill(s)} aria-label={t('disciplines.detail.deleteAria', { name: s.name })}>
                        {t('disciplines.detail.delete')}
                      </Button>
                    </div>
                  );
                },
              },
            ]}
          />
        )}
      </BillingCard>

      {discipline ? <LadderSection discipline={discipline} skills={skills} ranks={ranks} readOnly={!canEdit} showHolders={isOwner} canSetPrices={isOwner} /> : null}

      {discipline && isOwner ? <StudentsSection disciplineId={discipline.id} ranks={ranks} /> : null}

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
    </BillingPage>
  );
}

/** Who trains this style, by belt (Decision 309). Owner only: it reads the
 * same rung-holders list the ladder editor's confirmations use, keeping only
 * students still enrolled at the School (Decision 310). */
function StudentsSection({ disciplineId, ranks }: { disciplineId: string; ranks: Array<{ id: string; name: string; order: number; stripeTiers: Array<{ id: string; name: string; order: number }> }> }) {
  const t = useT();
  const { data, isLoading } = useRungHolders(disciplineId);
  if (isLoading) return null;
  const byRung = new Map((data?.items ?? []).map((item) => [item.rungId, item.students]));
  const rows = [...ranks]
    .sort((a, b) => a.order - b.order)
    .flatMap((rank) =>
      [...rank.stripeTiers].sort((a, b) => a.order - b.order).flatMap((tier) => (byRung.get(tier.id) ?? []).filter((s) => s.enrolled).map((s) => ({ ...s, id: s.studentId, rung: tier.name }))),
    );
  return (
    <BillingCard title={t('disciplines.detail.studentsHeading', { count: rows.length })}>
      {rows.length === 0 ? (
        <p className="u8b-note">{t('disciplines.detail.studentsEmpty')}</p>
      ) : (
        <FitTable<(typeof rows)[number]>
          rows={rows}
          columns={[
            {
              key: 'name',
              header: t('disciplines.detail.columnStudent'),
              main: true,
              render: (s) => (
                <Link to={`/students/${s.studentId}`} className="u8b-name">
                  {`${s.firstName} ${s.surname}`.trim()}
                </Link>
              ),
            },
            { key: 'rung', header: t('disciplines.detail.columnRank'), render: (s) => s.rung },
          ]}
        />
      )}
    </BillingCard>
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
