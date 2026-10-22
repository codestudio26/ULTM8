import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { nullsToUndefined } from '../lib/nullableFields';
import { useOwnedSchoolIds } from '../auth/AuthContext';
import { useDiscipline } from './disciplineQueries';
import { useCreateSkill, useDeleteSkill, useReorderSkills, useSkills, useUpdateSkill, type SkillResponse } from '../skills/skillQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { SkillFormModal } from '../skills/SkillFormModal';
import { useRanks, useRungHolders } from '../ranks/rankQueries';
import { LadderSection } from '../ranks/LadderSection';
import { useT } from '../i18n/I18nProvider';

/** A Discipline's own Skills and Ranks catalog. Reached via a "Manage
 * skills" link from DisciplinesPage's own table — both Skill and Rank CRUD
 * are nested under a Discipline (`/styles/:disciplineId/skills`,
 * `/styles/:disciplineId/ranks`), so there's no School-wide list to build a
 * standalone top-level page against for either.
 *
 * Decision 309: read-only for coaches and Branch Staff, and for everyone
 * while the style is archived. Skills are in the owner's order and show which
 * rungs require them and how many lessons teach them; the owner also sees
 * the students on each belt. */
export function DisciplineDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const disciplineId = id ?? null;
  const { data: discipline, isLoading: disciplineLoading, error: disciplineError } = useDiscipline(disciplineId);
  const { data: skillData, isLoading: skillsLoading, error: skillsError } = useSkills(disciplineId);
  const { data: rankData, isLoading: ranksLoading, error: ranksError } = useRanks(disciplineId);
  const ownedSchoolIds = useOwnedSchoolIds();
  const isOwner = !!discipline && ownedSchoolIds.includes(discipline.schoolId);
  const canEdit = isOwner && !discipline?.archivedAt;
  const createSkill = useCreateSkill(disciplineId ?? '');
  const reorderSkills = useReorderSkills(disciplineId ?? '');
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillResponse | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<SkillResponse | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const deleteSkill = useDeleteSkill(disciplineId ?? '');

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
    <>
      <PageHeader
        title={discipline?.name ?? t('disciplines.detail.fallbackTitle')}
        subtitle={discipline?.classTypesOffered.length ? discipline.classTypesOffered.join(', ') : undefined}
      />
      {discipline?.archivedAt ? (
        <div style={{ marginBottom: 16 }}>
          <Badge variant="default">{t('disciplines.list.archived')}</Badge> <span className="ultm8-field__hint">{t('disciplines.detail.archivedNote')}</span>
        </div>
      ) : !isOwner ? (
        <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
          {t('disciplines.detail.readOnlyNote')}
        </p>
      ) : null}

      <div style={{ marginBottom: 24 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 4 }}>
                {t('disciplines.detail.skillsHeading')}
              </h2>
              <p style={{ margin: 0 }}>{t('disciplines.detail.skillsIntro')}</p>
            </div>
            {canEdit ? <Button onClick={() => setCreatingSkill(true)}>{t('disciplines.detail.addSkill')}</Button> : null}
          </div>
          {skillError ? <ErrorBanner message={skillError} /> : null}
          {skills.length === 0 ? (
            <EmptyState title={t('disciplines.detail.emptyTitle')} description={t('disciplines.detail.emptyDescription')} />
          ) : (
            <Table<SkillResponse>
              rows={skills}
              columns={[
                { key: 'name', header: t('disciplines.detail.columnName'), render: (s) => s.name },
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
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button variant="secondary" onClick={() => void moveSkill(i, -1)} disabled={i === 0 || reorderSkills.isPending} aria-label={t('disciplines.detail.moveUpAria', { name: s.name })}>
                          ↑
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void moveSkill(i, 1)}
                          disabled={i === skills.length - 1 || reorderSkills.isPending}
                          aria-label={t('disciplines.detail.moveDownAria', { name: s.name })}
                        >
                          ↓
                        </Button>
                        <Button variant="secondary" onClick={() => setEditingSkill(s)}>
                          {t('disciplines.detail.edit')}
                        </Button>
                        <Button variant="secondary" onClick={() => setDeletingSkill(s)} aria-label={t('disciplines.detail.deleteAria', { name: s.name })}>
                          {t('disciplines.detail.delete')}
                        </Button>
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
        </Card>
      </div>

      {discipline ? <LadderSection discipline={discipline} skills={skills} ranks={ranks} readOnly={!canEdit} showHolders={isOwner} /> : null}

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

    </>
  );
}

/** Who trains this style, by belt (Decision 309). Owner only: it reads the
 * same rung-holders list the ladder editor's confirmations use. */
function StudentsSection({ disciplineId, ranks }: { disciplineId: string; ranks: Array<{ id: string; name: string; order: number; stripeTiers: Array<{ id: string; name: string; order: number }> }> }) {
  const t = useT();
  const { data, isLoading } = useRungHolders(disciplineId);
  if (isLoading) return null;
  const byRung = new Map((data?.items ?? []).map((item) => [item.rungId, item.students]));
  const rows = [...ranks]
    .sort((a, b) => a.order - b.order)
    .flatMap((rank) =>
      [...rank.stripeTiers].sort((a, b) => a.order - b.order).flatMap((tier) => (byRung.get(tier.id) ?? []).map((s) => ({ ...s, id: s.studentId, rung: tier.name }))),
    );
  return (
    <div style={{ marginTop: 24 }}>
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 4 }}>
          {t('disciplines.detail.studentsHeading', { count: rows.length })}
        </h2>
        {rows.length === 0 ? (
          <p className="ultm8-field__hint" style={{ margin: 0 }}>
            {t('disciplines.detail.studentsEmpty')}
          </p>
        ) : (
          <Table<(typeof rows)[number]>
            rows={rows}
            columns={[
              {
                key: 'name',
                header: t('disciplines.detail.columnStudent'),
                render: (s) => <Link to={`/students/${s.studentId}`}>{`${s.firstName} ${s.surname}`.trim()}</Link>,
              },
              { key: 'rung', header: t('disciplines.detail.columnRank'), render: (s) => s.rung },
            ]}
          />
        )}
      </Card>
    </div>
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
