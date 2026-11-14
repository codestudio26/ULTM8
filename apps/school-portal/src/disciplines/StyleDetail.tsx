import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { nullsToUndefined } from '../lib/nullableFields';
import { useOwnedSchoolIds } from '../auth/AuthContext';
import type { DisciplineResponse } from './disciplineQueries';
import { useCreateSkill, useDeleteSkill, useReorderSkills, useSkills, useUpdateSkill, type SkillResponse } from '../skills/skillQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { SkillFormModal } from '../skills/SkillFormModal';
import { type RankResponse, useRanks, useRungHolders } from '../ranks/rankQueries';
import { LadderSection } from '../ranks/LadderSection';
import { BeltChip } from '../grading/BeltChip';
import { useT, type TranslateFn } from '../i18n/I18nProvider';
import { BillingCard } from '../billing/BillingLook';
import { FitTable } from '../students/StudentsSectionLook';
import './stylesLook.css';

/** One style on Grading → Styles & Belts (Decision 462 item 9, the design's
 * layout): the style card the page passes in, then the style's Ladder, its
 * Skills and (owner only) its Students, with the side panel beside them
 * (under them on a phone). The panel is "About this style" until a belt is
 * picked in the Ladder; then it shows that belt and what each of its grades
 * takes, with ✕ to go back. Both Skill and Rank CRUD are nested under a
 * Discipline (`/styles/:disciplineId/skills`, `/styles/:disciplineId/ranks`).
 *
 * Decision 309: read-only for coaches and Branch Staff, and for everyone
 * while the style is archived. Skills are in the owner's order and show which
 * rungs require them and how many lessons teach them; the owner also sees
 * the students on each belt. Decision 383: Branch Staff the owner ticked "Can
 * manage disciplines" for edit it like the owner, except grade prices, and
 * still don't see the students. Same actions and checks as before. */
export function StyleDetail({ discipline, canManage, styleCard }: { discipline: DisciplineResponse | null; canManage: boolean; styleCard: React.ReactNode }) {
  const t = useT();
  const disciplineId = discipline?.id ?? null;
  const { data: skillData, isLoading: skillsLoading, error: skillsError } = useSkills(disciplineId);
  const { data: rankData, isLoading: ranksLoading, error: ranksError } = useRanks(disciplineId);
  const ownedSchoolIds = useOwnedSchoolIds();
  const isOwner = !!discipline && ownedSchoolIds.includes(discipline.schoolId);
  const canEdit = canManage && !!discipline && !discipline.archivedAt;
  const holdersQuery = useRungHolders(isOwner ? disciplineId : null);
  const createSkill = useCreateSkill(disciplineId ?? '');
  const reorderSkills = useReorderSkills(disciplineId ?? '');
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillResponse | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<SkillResponse | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [beltId, setBeltId] = useState<string | null>(null);
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
  /** Students on each rung (owner only), for the belt panel. */
  const holders = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of holdersQuery.data?.items ?? []) map.set(item.rungId, item.students.length);
    return map;
  }, [holdersQuery.data]);

  const skills = skillData?.items ?? [];
  const belt = ranks.find((r) => r.id === beltId) ?? null;
  const loadError = skillsError
    ? skillsError instanceof ApiError
      ? skillsError.message
      : t('disciplines.detail.skillsLoadFailed')
    : ranksError
      ? ranksError instanceof ApiError
        ? ranksError.message
        : t('disciplines.detail.ranksLoadFailed')
      : null;

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

  const main = (
    <div className="u8gs-main">
      {styleCard}
      {!discipline ? null : skillsLoading || ranksLoading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorBanner message={loadError} />
      ) : (
        <>
          <LadderSection
            discipline={discipline}
            skills={skills}
            ranks={ranks}
            readOnly={!canEdit}
            showHolders={isOwner}
            canSetPrices={isOwner}
            selectedId={beltId}
            onSelect={(id) => setBeltId((cur) => (cur === id ? null : id))}
          />

          <BillingCard>
            <section aria-label={t('disciplines.detail.skillsHeading')}>
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
                <ul className="u8gs-items" aria-label={t('disciplines.detail.skillsHeading')}>
                  {skills.map((s, i) => (
                    <li key={s.id} aria-label={s.name} className="u8gs-item u8gs-item--static">
                      <div className="u8gs-item__row">
                        <div className="u8gs-item__text">
                          <strong>{s.name}</strong>
                          {s.description ? <div className="u8b-note">{s.description}</div> : null}
                          <div className="u8b-note">
                            {t('disciplines.detail.columnRequiredOn')}: {(requiredOn.get(s.id) ?? []).join(', ') || '—'}
                          </div>
                          <div className="u8b-note">
                            {t('disciplines.detail.columnLessons')}: {s.lessonCount}
                          </div>
                        </div>
                        {canEdit ? (
                          <span className="u8gs-actions">
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
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </BillingCard>

          {isOwner ? <StudentsSection disciplineId={discipline.id} ranks={ranks} /> : null}
        </>
      )}
    </div>
  );

  return (
    <>
      {discipline ? (
        <div className="ultm8-board-layout ultm8-board-layout--with-panel u8gs-layout">
          {main}
          <aside className="ultm8-board-panel">
            <BillingCard>
              {belt ? (
                <BeltPanel discipline={discipline} rank={belt} skills={skills} holders={isOwner ? holders : null} onClose={() => setBeltId(null)} />
              ) : (
                <AboutStyle discipline={discipline} ranks={ranks} />
              )}
            </BillingCard>
          </aside>
        </div>
      ) : (
        main
      )}

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

      {editingSkill && disciplineId ? <EditSkillModal disciplineId={disciplineId} skill={editingSkill} onClose={() => setEditingSkill(null)} /> : null}
    </>
  );
}

/** "About this style": what the page doesn't already show. The class types
 * moved here from the page header, and the student count from the Students
 * card's heading, so neither is shown twice. */
function AboutStyle({ discipline, ranks }: { discipline: DisciplineResponse; ranks: RankResponse[] }) {
  const t = useT();
  const live = ranks.filter((r) => !r.archivedAt);
  const grades = live.reduce((n, r) => n + r.stripeTiers.length, 0);
  const levels = discipline.rankDisplay === 'LEVELS';
  const g = discipline.boardGettingThere;
  const r = discipline.boardReadyToGrade;
  return (
    <section aria-label={t('disciplines.detail.aboutTitle')} className="u8gs-panel">
      <div className="u8gs-label">{t('disciplines.detail.aboutTitle')}</div>
      <h2 className="u8gs-panel__name">{discipline.name}</h2>
      <p className="u8b-note">{t('disciplines.detail.aboutHint')}</p>
      <dl className="u8gs-stats">
        <div>
          <dt>{levels ? t('disciplines.detail.statLevels') : t('disciplines.detail.statBelts')}</dt>
          <dd>{live.length}</dd>
        </div>
        <div>
          <dt>{t('disciplines.detail.statGrades')}</dt>
          <dd>{grades}</dd>
        </div>
        <div>
          <dt>{t('disciplines.list.columnStudents')}</dt>
          <dd>{discipline.studentCount}</dd>
        </div>
      </dl>
      <h3>{t('disciplines.form.rankDisplayLabel')}</h3>
      <p className="u8gs-panel__text">{levels ? t('disciplines.form.rankDisplayLevels') : t('disciplines.form.rankDisplayBelts')}</p>
      <h3>{t('disciplines.list.columnClassTypes')}</h3>
      {discipline.classTypesOffered.length ? (
        <ul className="u8gs-chips">
          {discipline.classTypesOffered.map((type) => (
            <li key={type}>{type}</li>
          ))}
        </ul>
      ) : (
        <p className="u8gs-panel__text">—</p>
      )}
      <h3>{t('grading.settings.columns.title')}</h3>
      <dl className="u8gs-pairs">
        <div>
          <dt>{t('grading.board.columns.justStarting')}</dt>
          <dd>{t('grading.board.rangeUnder', { percent: g })}</dd>
        </div>
        <div>
          <dt>{t('grading.board.columns.gettingThere')}</dt>
          <dd>{t('grading.board.rangeBetween', { from: g, to: r - 1 })}</dd>
        </div>
        <div>
          <dt>{t('grading.board.columns.readyToGrade')}</dt>
          <dd>{t('grading.board.rangeFrom', { percent: r })}</dd>
        </div>
      </dl>
    </section>
  );
}

/** What one grade takes, one line per ticked requirement (Decision 321: only
 * the requirements the style ticks), in the belt editor's own words. */
function gradeLines(t: TranslateFn, d: DisciplineResponse, tier: RankResponse['stripeTiers'][number], skillNames: Map<string, string>): string[] {
  const lines: string[] = [];
  if (tier.timeOnly) {
    lines.push(`${t('ranks.editor.minYears')}: ${Math.round(((tier.minimumDaysInRank ?? 0) / 365) * 10) / 10}`);
  } else {
    if (d.requireClasses) {
      if (tier.classCountMode === 'EACH_TYPE') {
        const each = (tier.classTypeRequirements as Array<{ classType: string; classesRequired: number }>).map((x) => `${x.classesRequired} ${x.classType}`).join(' + ');
        if (each) lines.push(`${t('ranks.editor.classesRequired')}: ${each}`);
      } else {
        if (tier.classesRequired) lines.push(`${t('ranks.editor.classesRequired')}: ${tier.classesRequired}`);
        if (tier.eligibleClassTypes.length) lines.push(`${t('ranks.editor.typesLegend')}: ${tier.eligibleClassTypes.join(', ')}`);
      }
      if (tier.weeklyClassCountCap) lines.push(`${t('ranks.editor.weeklyCap')}: ${tier.weeklyClassCountCap}`);
    }
    if (d.requireDaysInRank && tier.minimumDaysInRank) lines.push(`${t('ranks.editor.minDays')}: ${tier.minimumDaysInRank}`);
    if (d.requireHours && tier.hoursRequired) lines.push(`${t('ranks.editor.hoursRequired')}: ${tier.hoursRequired}`);
    if (d.requireDaysAttended && tier.daysAttendedRequired) lines.push(`${t('ranks.editor.daysAttended')}: ${tier.daysAttendedRequired}`);
  }
  if (d.requireMinimumAge && tier.minimumAge) lines.push(`${t('ranks.editor.minimumAge')}: ${tier.minimumAge}`);
  if (d.requireSkills && tier.requiredSkillIds.length) {
    lines.push(`${t('ranks.editor.requiredSkills')}: ${tier.requiredSkillIds.map((id) => skillNames.get(id) ?? '—').join(', ')}`);
  }
  if (tier.bookingUnlocksClassTypes.length) lines.push(`${t('ranks.editor.unlocks')}: ${tier.bookingUnlocksClassTypes.join(', ')}`);
  return lines;
}

/** The picked belt: its picture and name, how many students hold it (owner
 * only), and what each of its grades takes. No Edit / Duplicate and no
 * stripe count: the Ladder row has them (DESIGN.md → "nothing shown twice"). */
function BeltPanel({
  discipline,
  rank,
  skills,
  holders,
  onClose,
}: {
  discipline: DisciplineResponse;
  rank: RankResponse;
  skills: SkillResponse[];
  holders: Map<string, number> | null;
  onClose: () => void;
}) {
  const t = useT();
  const tiers = [...rank.stripeTiers].sort((a, b) => a.order - b.order);
  const skillNames = new Map(skills.map((s) => [s.id, s.name]));
  const held = holders ? tiers.reduce((n, tier) => n + (holders.get(tier.id) ?? 0), 0) : null;
  const rung = (tier: (typeof tiers)[number], index: number) => ({ id: tier.id, rankId: rank.id, rank, tier, index, name: tier.name });
  return (
    <section aria-label={rank.name} className="u8gs-panel">
      <div className="u8gs-panel-head">
        <div className="u8gs-label">{rank.rankDisplay === 'LEVELS' ? t('disciplines.detail.levelLabel') : t('disciplines.detail.beltLabel')}</div>
        <button type="button" className="ultm8-round-button" onClick={onClose} aria-label={t('grading.board.panel.close')}>
          ✕
        </button>
      </div>
      {tiers[0] ? (
        <div className="u8gs-panel__belt">
          <BeltChip rung={rung(tiers[0], 0)} large />
        </div>
      ) : null}
      <h2 className="u8gs-panel__name">{rank.name}</h2>
      {held !== null ? <p className="u8b-note">{t('ranks.ladder.students', { count: held })}</p> : null}
      <ul className="u8gs-grades">
        {tiers.map((tier, i) => {
          const lines = gradeLines(t, discipline, tier, skillNames);
          return (
            <li key={tier.id}>
              <div className="u8gs-grades__head">
                <BeltChip rung={rung(tier, i)} />
                <strong>{tier.name}</strong>
              </div>
              {lines.length ? lines.map((line) => <div key={line} className="u8b-note">{line}</div>) : <div className="u8b-note">—</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Who trains this style, by belt (Decision 309). Owner only: it reads the
 * same rung-holders list the ladder editor's confirmations use, keeping only
 * students still enrolled at the School (Decision 310). The count is in
 * About this style, so the heading has none. */
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
    <BillingCard title={t('disciplines.list.columnStudents')}>
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
