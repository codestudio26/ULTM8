import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useDisciplines } from '../disciplines/disciplineQueries';
import { useRanks } from '../ranks/rankQueries';
import { useCreateSkill, useDeleteSkill, useReorderSkills, useSkills, useUpdateSkill, type SkillResponse } from '../skills/skillQueries';
import { SkillFormModal } from '../skills/SkillFormModal';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { nullsToUndefined } from '../lib/nullableFields';
import { useMyGrading } from './gradingQueries';
import { GradingTabs } from './GradingTabs';
import { useT } from '../i18n/I18nProvider';

/**
 * Grading → Skills (DESIGN.md → "Grading screens", Skills tab): pick a style,
 * then its skills in the owner's order with + Add skill, and Edit and Delete
 * on every row. Each row shows how many grades require the skill and how many
 * lessons teach it; the right panel shows the selected skill. The owner edits
 * (Decision 309: read-only for coaches, and while the style is archived);
 * a skill students are being signed off on can't be deleted, and the API says why.
 */
export function GradingSkillsPage() {
  const schoolId = useGradingSchoolId();
  const t = useT();
  const my = useMyGrading(schoolId);
  const disciplines = useDisciplines(schoolId);
  const styles = useMemo(() => (disciplines.data?.items ?? []).filter((d) => my.mayGradeStyle(d.id)), [disciplines.data, my]);
  const [disciplineId, setDisciplineId] = useState<string | null>(null);
  useEffect(() => {
    if (!disciplineId && styles.length > 0) setDisciplineId(styles[0].id);
  }, [disciplineId, styles]);
  const style = styles.find((d) => d.id === disciplineId) ?? null;
  const skills = useSkills(disciplineId);
  const ranks = useRanks(disciplineId);
  const createSkill = useCreateSkill(disciplineId ?? '');
  const deleteSkill = useDeleteSkill(disciplineId ?? '');
  const reorder = useReorderSkills(disciplineId ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SkillResponse | null>(null);
  const [deleting, setDeleting] = useState<SkillResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The grades that require each skill, in ladder order. */
  const requiredOn = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const rank of [...(ranks.data?.items ?? [])].sort((a, b) => a.order - b.order)) {
      if (rank.archivedAt) continue;
      for (const tier of [...rank.stripeTiers].sort((a, b) => a.order - b.order)) {
        for (const id of tier.requiredSkillIds ?? []) map.set(id, [...(map.get(id) ?? []), tier.name]);
      }
    }
    return map;
  }, [ranks.data]);

  if (!schoolId) return null;
  if (my.isLoading || disciplines.isLoading) return <Spinner />;
  const loadError = my.error ?? disciplines.error;
  if (loadError) return <ErrorBanner message={loadError instanceof ApiError ? loadError.message : t('grading.skills.loadFailed')} />;

  const canEdit = my.isOwner && !!style && !style.archivedAt;
  const list = skills.data?.items ?? [];
  const selected = list.find((s) => s.id === selectedId) ?? null;

  async function move(i: number, delta: number) {
    const ids = list.map((s) => s.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setError(null);
    try {
      await reorder.mutateAsync(ids);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <>
      <PageHeader title={t('grading.skills.title')} subtitle={t('grading.skills.subtitle')} />
      <GradingTabs />
      {styles.length === 0 ? (
        <Card>
          <EmptyState title={t('grading.noStylesTitle')} description={t('grading.board.noStylesDescription')} />
        </Card>
      ) : (
        <div className={`ultm8-board-layout${selected ? ' ultm8-board-layout--with-panel' : ''}`} style={{ marginTop: 0 }}>
          <Card>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 200 }}>
                <Field label={t('grading.board.styleLabel')} htmlFor="skills-style">
                  <SelectField
                    value={disciplineId ?? ''}
                    onChange={(e) => {
                      setDisciplineId(e.target.value);
                      setSelectedId(null);
                    }}
                    options={styles.map((d) => ({ value: d.id, label: d.name }))}
                  />
                </Field>
              </div>
              <span style={{ flex: 1 }} />
              {canEdit ? (
                <div style={{ paddingBottom: 12 }}>
                  <Button onClick={() => setAdding(true)}>{t('grading.skills.add')}</Button>
                </div>
              ) : null}
            </div>
            {!my.isOwner ? <p className="ultm8-field__hint">{t('disciplines.detail.readOnlyNote')}</p> : style?.archivedAt ? <p className="ultm8-field__hint">{t('disciplines.detail.archivedNote')}</p> : null}
            {error ? <ErrorBanner message={error} /> : null}
            {skills.isLoading || ranks.isLoading ? (
              <Spinner />
            ) : list.length === 0 ? (
              <EmptyState title={t('disciplines.detail.emptyTitle')} description={t('disciplines.detail.emptyDescription')} />
            ) : (
              <ul aria-label={t('grading.skills.listAria', { style: style?.name ?? '' })} style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>
                {list.map((s, i) => {
                  const grades = requiredOn.get(s.id) ?? [];
                  return (
                    <li
                      key={s.id}
                      aria-label={s.name}
                      className={`ultm8-board-card${selectedId === s.id ? ' ultm8-board-card--open' : ''}`}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button')) return;
                        setSelectedId(s.id);
                      }}
                    >
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <strong>{s.name}</strong>
                          <div className="ultm8-field__hint">
                            {t('grading.skills.counts', { grades: grades.length, lessons: s.lessonCount })}
                          </div>
                        </div>
                        {canEdit ? (
                          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                            <Button variant="secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('disciplines.detail.moveUpAria', { name: s.name })}>
                              ↑
                            </Button>
                            <Button variant="secondary" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={t('disciplines.detail.moveDownAria', { name: s.name })}>
                              ↓
                            </Button>
                            <Button variant="secondary" onClick={() => setEditing(s)} aria-label={t('grading.skills.editAria', { name: s.name })}>
                              {t('disciplines.detail.edit')}
                            </Button>
                            <Button variant="secondary" onClick={() => setDeleting(s)} aria-label={t('disciplines.detail.deleteAria', { name: s.name })}>
                              {t('disciplines.detail.delete')}
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {selected ? (
            <aside className="ultm8-board-panel">
              <Card>
                <section aria-label={t('grading.skills.panelAria', { name: selected.name })}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h2 className="ultm8-page-header__title" style={{ fontSize: 18, margin: 0, flex: 1 }}>
                      {selected.name}
                    </h2>
                    <button type="button" className="ultm8-round-button" onClick={() => setSelectedId(null)} aria-label={t('grading.board.panel.close')}>
                      ✕
                    </button>
                  </div>
                  <p style={{ marginBottom: 0 }}>{selected.description || t('grading.skills.noDescription')}</p>
                  <h3 style={{ fontSize: 15, margin: '16px 0 6px' }}>{t('disciplines.detail.columnRequiredOn')}</h3>
                  {(requiredOn.get(selected.id) ?? []).length === 0 ? (
                    <p className="ultm8-field__hint" style={{ margin: 0 }}>
                      {t('grading.skills.notRequired')}
                    </p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {(requiredOn.get(selected.id) ?? []).map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  )}
                  <h3 style={{ fontSize: 15, margin: '16px 0 6px' }}>{t('disciplines.detail.columnLessons')}</h3>
                  <p style={{ margin: 0 }}>{selected.lessonCount}</p>
                </section>
              </Card>
            </aside>
          ) : null}
        </div>
      )}

      {adding ? (
        <SkillFormModal
          title={t('disciplines.detail.addSkillTitle')}
          submitting={createSkill.isPending}
          onSubmit={async (values) => {
            await createSkill.mutateAsync(nullsToUndefined(values));
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing && disciplineId ? <EditSkill disciplineId={disciplineId} skill={editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <ConfirmDeleteModal
          title={t('disciplines.detail.deleteTitle', { name: deleting.name })}
          description={t('disciplines.detail.deleteDescription')}
          onConfirm={async () => {
            await deleteSkill.mutateAsync(deleting.id);
            if (selectedId === deleting.id) setSelectedId(null);
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </>
  );
}

function EditSkill({ disciplineId, skill, onClose }: { disciplineId: string; skill: SkillResponse; onClose: () => void }) {
  const t = useT();
  const update = useUpdateSkill(disciplineId, skill.id);
  return (
    <SkillFormModal
      title={t('disciplines.detail.editSkillTitle')}
      initial={skill}
      submitting={update.isPending}
      onSubmit={async (values) => {
        await update.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
