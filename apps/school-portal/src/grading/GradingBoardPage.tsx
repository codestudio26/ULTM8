import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Modal, PageHeader, SelectField, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useRanks } from '../ranks/rankQueries';
import { BeltChip } from './BeltChip';
import { flattenLadder, type Rung } from './ladder';
import { useBranches } from '../branches/branchQueries';
import { type BoardColumn, type GradingBoardItem, useBoardMove, useGradingBoard, useMyGrading, useSetBoardThresholds, useSetHomeBranch } from './gradingQueries';
import { BulkPromoteModal } from './BulkPromoteModal';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

/** Column labels are translation keys, resolved at render time. */
export const COLUMNS: Array<{ key: BoardColumn; label: TranslationKey }> = [
  { key: 'JUST_STARTING', label: 'grading.board.columns.justStarting' },
  { key: 'GETTING_THERE', label: 'grading.board.columns.gettingThere' },
  { key: 'READY_TO_GRADE', label: 'grading.board.columns.readyToGrade' },
];

export const fullName = (i: { firstName: string; surname: string }) => `${i.firstName} ${i.surname}`.trim();

/** Cards shown per column before "Show all" — keeps a 500-student board quick. */
const PAGE = 25;

/**
 * Grading Board (roadmap Phase 4, item 3; Decisions 128, 130, 136, 152, 176):
 * every student with a next rank in one style, in three columns by progress
 * (33% / 66% by default; per-school thresholds come with the grading
 * settings). Search, "currently attending only", tick students and promote
 * them together, and move a student to another column by dragging the card
 * or with its Move button — after a confirmation, since it rewrites their
 * progress and is recorded on their history. The owner also sees a "No
 * branch" group of students without a home branch, whom no branch coach
 * sees, and gives each one a branch there (Decision 148.2).
 */
export function GradingBoardPage() {
  const schoolId = useGradingSchoolId();
  const disciplines = useDisciplines(schoolId);
  const my = useMyGrading(schoolId);
  const t = useT();
  // A coach sees only the styles they grade in (Decisions 181, 184).
  const styles = (disciplines.data?.items ?? []).filter((d) => my.mayGradeStyle(d.id));
  const [disciplineId, setDisciplineId] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [moving, setMoving] = useState<{ item: GradingBoardItem; to?: BoardColumn } | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingThresholds, setEditingThresholds] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);

  useEffect(() => {
    if (!disciplineId && styles.length > 0) setDisciplineId(styles[0].id);
  }, [disciplineId, styles]);

  const board = useGradingBoard(schoolId, disciplineId, activeOnly);
  const ranks = useRanks(disciplineId);
  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const style = styles.find((d) => d.id === disciplineId) ?? null;

  if (!schoolId) return null;
  if (disciplines.isLoading || my.isLoading) return <Spinner />;
  if (disciplines.error) return <ErrorBanner message={disciplines.error instanceof ApiError ? disciplines.error.message : t('grading.board.loadStylesFailed')} />;
  if (my.error) return <ErrorBanner message={my.error instanceof ApiError ? my.error.message : t('grading.board.loadPermissionsFailed')} />;
  const canPromote = my.can(disciplineId, 'canPromote');
  const canMove = my.can(disciplineId, 'canAdjustProgress');

  const items = board.data?.items ?? [];
  const term = search.trim().toLowerCase();
  const visible = term ? items.filter((i) => fullName(i).toLowerCase().includes(term)) : items;
  // Only the owner gets students with no home branch (Decision 148.2); they
  // sit in their own group, not in the columns, until they have one.
  const noBranch = visible.filter((i) => i.noHomeBranch);
  const byColumn = (col: BoardColumn) => visible.filter((i) => !i.noHomeBranch && i.eligibility.boardColumn === col);
  // Only active students are graded up (Decision 283).
  const selectable = (i: GradingBoardItem) => !i.hardBlocked && i.active;
  const isSelected = (id: string) => selected.includes(id);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  // Selected students still on the board, in the order they were ticked.
  const selectedItems = selected.map((id) => items.find((i) => i.studentId === id)).filter((i): i is GradingBoardItem => !!i && selectable(i));
  // Ticked students a search now hides are still in the batch: say so.
  const hiddenSelected = term ? selectedItems.filter((i) => !visible.includes(i)).length : 0;
  const shown = (key: string, list: GradingBoardItem[]) => (expanded.includes(key) ? list : list.slice(0, PAGE));
  const showAll = (key: string, total: number) =>
    total > PAGE && !expanded.includes(key) ? (
      <div style={{ marginTop: 10 }}>
        <Button variant="secondary" fullWidth onClick={() => setExpanded((x) => [...x, key])}>
          {t('grading.board.showAll', { count: total })}
        </Button>
      </div>
    ) : null;

  return (
    <>
      <PageHeader
        title={t('grading.board.title')}
        subtitle={t('grading.board.subtitle')}
      />
      {styles.length === 0 ? (
        <Card>
          {my.isOwner ? (
            <EmptyState title={t('grading.noStylesTitle')} description={t('grading.board.noStylesDescription')} />
          ) : (
            <EmptyState title={t('grading.noStylesToGradeTitle')} description={t('grading.noStylesToGradeDescription')} />
          )}
        </Card>
      ) : (
        <>
          <Card>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 180 }}>
                <Field label={t('grading.board.styleLabel')} htmlFor="board-style">
                  <SelectField
                    value={disciplineId ?? ''}
                    onChange={(e) => {
                      setDisciplineId(e.target.value);
                      setSelected([]);
                      setExpanded([]);
                    }}
                    options={styles.map((d) => ({ value: d.id, label: d.name }))}
                  />
                </Field>
              </div>
              <div style={{ minWidth: 200 }}>
                <Field label={t('grading.board.searchLabel')} htmlFor="board-search">
                  <TextField type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
                </Field>
              </div>
              <div style={{ paddingBottom: 12 }}>
                <Checkbox label={t('grading.board.activeOnly')} checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
                {activeOnly && board.data && board.data.hiddenInactive > 0 ? (
                  <span className="ultm8-field__hint"> {t('grading.board.inactiveHidden', { count: board.data.hiddenInactive })}</span>
                ) : null}
                {board.data && board.data.atTopRank > 0 ? (
                  <span className="ultm8-field__hint"> {t('grading.board.atTopRank', { count: board.data.atTopRank })}</span>
                ) : null}
              </div>
              {style ? (
                <div style={{ paddingBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="ultm8-field__hint">
                    {t('grading.board.columnsAt', { gettingThere: style.boardGettingThere, readyToGrade: style.boardReadyToGrade })}
                  </span>
                  {my.can(style.id, 'canChangeBoardThresholds') ? (
                    <Button variant="secondary" onClick={() => setEditingThresholds(true)}>
                      {t('grading.board.changePercent')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div style={{ flex: 1 }} />
              <div style={{ paddingBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                {canPromote && selectedItems.length > 0 ? <strong>{t('grading.board.selectedCount', { count: selectedItems.length })}</strong> : null}
                {canPromote && hiddenSelected > 0 ? (
                  <span className="ultm8-field__hint">
                    {t('grading.board.hiddenBySearch', { count: hiddenSelected })}{' '}
                    <Button variant="secondary" onClick={() => setSearch('')}>
                      {t('grading.board.showThem')}
                    </Button>
                  </span>
                ) : null}
                {canPromote ? (
                  <Button onClick={() => setPromoting(true)} disabled={selectedItems.length === 0}>
                    {t('grading.board.promoteSelected')}
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>

          {board.isLoading || ranks.isLoading ? (
            <Spinner />
          ) : board.error ? (
            <ErrorBanner message={board.error instanceof ApiError ? board.error.message : t('grading.board.loadBoardFailed')} />
          ) : (
            <>
            {noBranch.length > 0 && schoolId ? (
              <section aria-label={t('grading.board.noBranch')} style={{ marginTop: 16 }}>
                <Card>
                  <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: '0 0 4px' }}>
                    {t('grading.board.noBranch')} <Badge>{noBranch.length}</Badge>
                  </h2>
                  <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
                    {t('grading.board.noBranchHint')}
                  </p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                    {shown('NO_BRANCH', noBranch).map((item) => (
                      <BoardCard
                        key={item.studentId}
                        item={item}
                        rung={ladder.find((r) => r.id === item.currentStripeId) ?? null}
                        selected={isSelected(item.studentId)}
                        onToggle={canPromote ? () => toggle(item.studentId) : undefined}
                        onDragStart={() => setDraggingId(null)}
                        footer={<AssignHomeBranch schoolId={schoolId} item={item} />}
                      />
                    ))}
                  </ul>
                  {showAll('NO_BRANCH', noBranch.length)}
                </Card>
              </section>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 16, alignItems: 'start' }}>
              {COLUMNS.map((col) => {
                const list = byColumn(col.key);
                const pickable = list.filter(selectable).map((i) => i.studentId);
                const allPicked = pickable.length > 0 && pickable.every(isSelected);
                return (
                  <section
                    key={col.key}
                    aria-label={t(col.label)}
                    onDragOver={(e) => {
                      if (canMove) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!canMove) return;
                      const item = items.find((i) => i.studentId === draggingId);
                      setDraggingId(null);
                      if (item && item.eligibility.boardColumn !== col.key) setMoving({ item, to: col.key });
                    }}
                  >
                    <Card>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
                          {t(col.label)} <Badge>{list.length}</Badge>
                          {style ? (
                            <span className="ultm8-field__hint" style={{ fontWeight: 400, marginLeft: 6 }}>
                              {col.key === 'JUST_STARTING'
                                ? t('grading.board.rangeUnder', { percent: style.boardGettingThere })
                                : col.key === 'GETTING_THERE'
                                  ? t('grading.board.rangeBetween', { from: style.boardGettingThere, to: style.boardReadyToGrade - 1 })
                                  : t('grading.board.rangeFrom', { percent: style.boardReadyToGrade })}
                            </span>
                          ) : null}
                        </h2>
                        {canPromote && pickable.length > 0 ? (
                          <Checkbox
                            label={t('grading.board.selectAll')}
                            aria-label={t('grading.board.selectAllIn', { column: t(col.label) })}
                            checked={allPicked}
                            onChange={() =>
                              setSelected((s) => (allPicked ? s.filter((id) => !pickable.includes(id)) : [...s, ...pickable.filter((id) => !s.includes(id))]))
                            }
                          />
                        ) : null}
                      </div>
                      {list.length === 0 ? (
                        <p className="ultm8-field__hint" style={{ textAlign: 'center', padding: '16px 0' }}>
                          {t('grading.board.noStudentsHere')}
                        </p>
                      ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                          {shown(col.key, list).map((item) => (
                            <BoardCard
                              key={item.studentId}
                              item={item}
                              rung={ladder.find((r) => r.id === item.currentStripeId) ?? null}
                              selected={isSelected(item.studentId)}
                              onToggle={canPromote ? () => toggle(item.studentId) : undefined}
                              onMove={canMove ? () => setMoving({ item }) : undefined}
                              onDragStart={() => setDraggingId(item.studentId)}
                            />
                          ))}
                        </ul>
                      )}
                      {showAll(col.key, list.length)}
                    </Card>
                  </section>
                );
              })}
            </div>
            </>
          )}
        </>
      )}

      {moving && disciplineId ? <MoveDialog disciplineId={disciplineId} item={moving.item} initialTo={moving.to} onClose={() => setMoving(null)} /> : null}
      {editingThresholds && style ? <ThresholdsDialog style={style} onClose={() => setEditingThresholds(false)} /> : null}
      {promoting && style && schoolId ? (
        <BulkPromoteModal
          schoolId={schoolId}
          style={style}
          ladder={ladder}
          students={selectedItems}
          onRemove={(id) => setSelected((s) => s.filter((x) => x !== id))}
          onDone={() => setSelected([])}
          onClose={() => setPromoting(false)}
        />
      ) : null}
    </>
  );
}

function BoardCard({
  item,
  rung,
  selected,
  onToggle,
  onMove,
  onDragStart,
  footer,
}: {
  item: GradingBoardItem;
  rung: Rung | null;
  selected: boolean;
  /** Absent when the caller may not promote in this style. */
  onToggle?: () => void;
  /** Absent when the caller may not adjust progress in this style. */
  onMove?: () => void;
  onDragStart: () => void;
  /** Extra controls under the card, e.g. assigning a home branch. */
  footer?: React.ReactNode;
}) {
  const t = useT();
  const name = fullName(item);
  const e = item.eligibility;
  const percent = e.progressPercent ?? 0;
  const skillsMissing = !e.timeOnly && e.skillsOk === false;
  const daysShort = e.daysOk === false ? (e.requiredDays ?? 0) - (e.elapsedDays ?? 0) : 0;
  return (
    <li
      draggable={!!onMove}
      onDragStart={(ev) => {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', item.studentId);
        onDragStart();
      }}
      aria-label={name}
      style={{
        border: `1px solid ${selected ? 'var(--fill-accent)' : 'var(--border)'}`,
        background: selected ? 'var(--bg-accent)' : 'var(--surface-1)',
        borderRadius: 10,
        padding: 12,
        cursor: onMove ? 'grab' : undefined,
        opacity: item.active ? 1 : 0.7,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onToggle ? (
          <input
            type="checkbox"
            checked={selected}
            disabled={item.hardBlocked || !item.active}
            onChange={onToggle}
            aria-label={
              item.hardBlocked
                ? t('grading.board.card.cantSelectAria', { name })
                : !item.active
                  ? t('grading.board.card.inactiveAria', { name })
                  : t('grading.board.card.selectAria', { name })
            }
            title={item.hardBlocked ? t('grading.board.card.cantSelectTitle') : !item.active ? t('grading.board.card.inactiveTitle') : undefined}
          />
        ) : null}
        {rung ? <BeltChip rung={rung} /> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/students/${item.studentId}`} state={{ name }} style={{ fontWeight: 700 }}>
            {name}
          </Link>
          <div className="ultm8-field__hint">{rung?.name ?? t('grading.board.card.rankNotOnLadder')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: percent >= 100 ? 'var(--text-success)' : undefined }}>{percent}%</div>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={t('grading.board.card.progressAria', { name })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        style={{ height: 4, borderRadius: 3, background: 'var(--color-neutral-200)', overflow: 'hidden', margin: '8px 0' }}
      >
        <div style={{ width: `${percent}%`, height: '100%', background: percent >= 66 ? 'var(--color-success)' : 'var(--fill-accent)' }} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {e.eligible ? <Badge variant="success">{t('grading.board.card.ready')}</Badge> : null}
        {item.hardBlocked ? <Badge variant="danger">{t('grading.board.card.skillsRequired')}</Badge> : skillsMissing ? <Badge variant="accent">{t('grading.board.card.skillsNotSignedOff')}</Badge> : null}
        {daysShort > 0 ? <Badge variant="accent">{t('grading.board.card.daysShort', { count: daysShort })}</Badge> : null}
        {item.active ? null : <Badge>{t('grading.board.card.inactive')}</Badge>}
        {item.verificationStatus === 'UNVERIFIED' ? <Badge variant="danger">{t('grading.board.card.notVerified')}</Badge> : null}
        <span style={{ flex: 1 }} />
        {onMove ? (
          <Button variant="secondary" onClick={onMove} aria-label={t('grading.board.card.moveAria', { name })}>
            {t('grading.board.card.move')}
          </Button>
        ) : null}
      </div>
      {footer}
    </li>
  );
}

/** Give a student with no home branch one of the School's branches
 * (Decisions 148, 168). Owner only, like the group it sits in. */
function AssignHomeBranch({ schoolId, item }: { schoolId: string; item: GradingBoardItem }) {
  const branches = useBranches(schoolId);
  const assign = useSetHomeBranch(schoolId);
  const [branchId, setBranchId] = useState('');
  const t = useT();
  const name = fullName(item);
  const id = `home-branch-${item.studentId}`;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 140 }}>
        <Field label={t('grading.board.assign.label', { name })} htmlFor={id}>
          <SelectField
            id={id}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={[{ value: '', label: t('grading.board.assign.placeholder') }, ...(branches.data?.items ?? []).map((b) => ({ value: b.id, label: b.name }))]}
          />
        </Field>
      </div>
      <Button
        onClick={() => assign.mutate({ studentId: item.studentId, branchId })}
        disabled={!branchId}
        loading={assign.isPending}
        aria-label={t('grading.board.assign.aria', { name })}
      >
        {t('grading.board.assign.submit')}
      </Button>
      {assign.error ? <ErrorBanner message={assign.error instanceof ApiError ? assign.error.message : t('grading.board.assign.failed')} /> : null}
    </div>
  );
}

/** Confirm a move to another column (Decision 128, item 13; Decision 174):
 * the API sets the student's classes (each type to the column's %, on an
 * "each type" rank) or, on a time-only rank, their rank date, and records it. */
function MoveDialog({
  disciplineId,
  item,
  initialTo,
  onClose,
}: {
  disciplineId: string;
  item: GradingBoardItem;
  initialTo?: BoardColumn;
  onClose: () => void;
}) {
  const move = useBoardMove(disciplineId);
  const others = COLUMNS.filter((c) => c.key !== item.eligibility.boardColumn);
  const [to, setTo] = useState<BoardColumn>(initialTo ?? others[0].key);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const labelKey = COLUMNS.find((c) => c.key === to)?.label;
  const label = labelKey ? t(labelKey) : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await move.mutateAsync({ studentId: item.studentId, column: to });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('grading.board.moveDialog.title', { name: fullName(item) })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('grading.board.moveDialog.toLabel')} htmlFor="move-to">
          <SelectField value={to} onChange={(e) => setTo(e.target.value as BoardColumn)} options={others.map((c) => ({ value: c.key, label: t(c.label) }))} />
        </Field>
        <p className="ultm8-field__hint">
          {item.eligibility.timeOnly
            ? t('grading.board.moveDialog.hintTimeOnly', { column: label ?? '' })
            : t('grading.board.moveDialog.hintClasses', { column: label ?? '' })}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={move.isPending}>
            {t('grading.board.moveDialog.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Change this style's columns (Decisions 75, 136, 181): the owner, or a
 * coach with "Change board %" for the style. Whole percentages; "Getting
 * There" starts below "Ready to Grade". */
function ThresholdsDialog({ style, onClose }: { style: DisciplineResponse; onClose: () => void }) {
  const set = useSetBoardThresholds(style.id);
  const t = useT();
  const [gettingThere, setGettingThere] = useState(String(style.boardGettingThere));
  const [readyToGrade, setReadyToGrade] = useState(String(style.boardReadyToGrade));
  const [error, setError] = useState<string | null>(null);
  const g = Number(gettingThere);
  const r = Number(readyToGrade);
  const valid = Number.isInteger(g) && Number.isInteger(r) && g >= 1 && r <= 99 && g < r;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await set.mutateAsync({ gettingThere: g, readyToGrade: r });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('grading.board.thresholds.title', { style: style.name })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
          {t('grading.board.thresholds.explanation')}
        </p>
        <Field label={t('grading.board.thresholds.gettingThereLabel')} htmlFor="threshold-getting-there">
          <TextField type="number" min={1} max={98} step={1} required value={gettingThere} onChange={(e) => setGettingThere(e.target.value)} />
        </Field>
        <Field label={t('grading.board.thresholds.readyToGradeLabel')} htmlFor="threshold-ready">
          <TextField type="number" min={2} max={99} step={1} required value={readyToGrade} onChange={(e) => setReadyToGrade(e.target.value)} />
        </Field>
        {valid ? (
          <p className="ultm8-field__hint">
            {t('grading.board.thresholds.summary', { g, r, r1: r - 1 })}
          </p>
        ) : (
          <p role="alert" className="ultm8-field__error">
            {t('grading.board.thresholds.invalid')}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={set.isPending} disabled={!valid}>
            {t('common.save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setGettingThere('33');
              setReadyToGrade('66');
            }}
          >
            {t('grading.board.thresholds.reset')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
