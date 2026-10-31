import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Modal, PageHeader, SelectField, Spinner, TextField, ViewToggle, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useGradingSchoolId } from '../auth/AuthContext';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useRanks } from '../ranks/rankQueries';
import { useInstructors } from '../instructors/instructorQueries';
import { BeltChip } from './BeltChip';
import { flattenLadder, type Rung } from './ladder';
import { branchSelectOptions, useBranches } from '../branches/branchQueries';
import {
  type BoardColumn,
  type GradingBoardItem,
  useBoardMove,
  useGradingBoard,
  useMyGrading,
  usePromotionFeeSettings,
  useSetBoardThresholds,
  useSetHomeBranch,
} from './gradingQueries';
import { BulkPromoteModal } from './BulkPromoteModal';
import { GradeModal } from './GradingModals';
import { GradingTabs } from './GradingTabs';
import { Avatar, DecideDialog, FeeTag, SelectionPanel, StudentPanel, fullName } from './BoardPanels';
import { feeRankName } from './feeRank';
import { programPair, useAdultProgram } from './adultProgram';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

/** Column labels are translation keys, resolved at render time. */
export const COLUMNS: Array<{ key: BoardColumn; label: TranslationKey }> = [
  { key: 'JUST_STARTING', label: 'grading.board.columns.justStarting' },
  { key: 'GETTING_THERE', label: 'grading.board.columns.gettingThere' },
  { key: 'READY_TO_GRADE', label: 'grading.board.columns.readyToGrade' },
];

export { fullName };

/** Cards shown per column before "Show all" — keeps a 500-student board quick. */
const PAGE = 25;

/** Each board level's soft colour (DESIGN.md → "Progress bar colours"). */
const LEVEL_CLASS: Record<BoardColumn, string> = {
  JUST_STARTING: 'just-starting',
  GETTING_THERE: 'getting-there',
  READY_TO_GRADE: 'ready',
};

type SortKey = 'belt' | 'name';
type Panel = { kind: 'student'; studentId: string } | { kind: 'selection' } | null;

/**
 * Grading Board (roadmap Phase 4, item 3; Decisions 128, 130, 136, 152, 176;
 * the New Portal layout in DESIGN.md → "Grading screens"): every student with
 * a next rank in one style, by progress (33% / 66% by default; per-style
 * thresholds), shown as three columns (Grid) or three stacked groups with
 * Ready to Grade on top (Rows), sorted inside each stage by belt or name.
 * Clicking a card opens the student's panel; ticking students opens the
 * Selection panel, which "–" turns into a pill. Every progress bar opens the
 * promote dialog for that one student. Search, "currently attending only",
 * and moving a student to another column (drag or Move, after a
 * confirmation, since it rewrites their progress and is recorded). The owner
 * also sees a "No branch" group of students without a home branch, whom no
 * branch coach sees, and gives each one a branch there (Decision 148.2).
 */
export function GradingBoardPage() {
  const schoolId = useGradingSchoolId();
  const { claims } = useAuth();
  const disciplines = useDisciplines(schoolId);
  const my = useMyGrading(schoolId);
  const feeSettings = usePromotionFeeSettings(schoolId);
  const instructors = useInstructors(schoolId);
  const t = useT();
  // A coach sees only the styles they grade in (Decisions 181, 184).
  const styles = (disciplines.data?.items ?? []).filter((d) => my.mayGradeStyle(d.id));
  const [disciplineId, setDisciplineId] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [moving, setMoving] = useState<{ item: GradingBoardItem; to?: BoardColumn } | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promotingOne, setPromotingOne] = useState<{ item: GradingBoardItem; targetRungId?: string } | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingThresholds, setEditingThresholds] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>('grid');
  const [sortKey, setSortKey] = useState<SortKey>('belt');
  const [ascending, setAscending] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);

  useEffect(() => {
    if (!disciplineId && styles.length > 0) setDisciplineId(styles[0].id);
  }, [disciplineId, styles]);

  const board = useGradingBoard(schoolId, disciplineId, activeOnly);
  const ranks = useRanks(disciplineId);
  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const style = styles.find((d) => d.id === disciplineId) ?? null;
  // Backlog 3.20: Kids and Adult are two linked styles, shown with a switch.
  const pair = programPair(style, disciplines.data?.items ?? []);
  const adultProgram = useAdultProgram(style, disciplines.data?.items ?? [], !!promotingOne?.item.readyForAdult);
  // Bulk promote's "Adult program" group (Decision 281 item 2), loaded while the window is open.
  const bulkAdultProgram = useAdultProgram(style, disciplines.data?.items ?? [], promoting);
  const staffNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const i of instructors.data?.items ?? []) names.set(i.userId, `${i.firstName} ${i.surname}`.trim());
    return names;
  }, [instructors.data]);

  if (!schoolId) return null;
  if (disciplines.isLoading || my.isLoading) return <Spinner />;
  if (disciplines.error) return <ErrorBanner message={disciplines.error instanceof ApiError ? disciplines.error.message : t('grading.board.loadStylesFailed')} />;
  if (my.error) return <ErrorBanner message={my.error instanceof ApiError ? my.error.message : t('grading.board.loadPermissionsFailed')} />;
  const canPromote = my.can(disciplineId, 'canPromote');
  const canMove = my.can(disciplineId, 'canAdjustProgress');
  const fee = feeSettings.data?.promotionFeeEnabled ? { currency: feeSettings.data.currency ?? null } : null;
  const performerName = (userId: string | null | undefined) =>
    !userId ? t('grading.student.formerInstructor') : userId === claims?.sub ? t('grading.student.you') : staffNames.get(userId) ?? t('grading.student.staffMember');

  const items = board.data?.items ?? [];
  const term = search.trim().toLowerCase();
  const rungIndex = (i: GradingBoardItem) => ladder.find((r) => r.id === i.currentStripeId)?.index ?? -1;
  const byName = (a: GradingBoardItem, b: GradingBoardItem) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName);
  // Inside each stage: by belt (lowest grade first, then surname) or by name.
  const sorted = (list: GradingBoardItem[]) =>
    [...list].sort((a, b) => {
      const order = sortKey === 'belt' ? rungIndex(a) - rungIndex(b) || byName(a, b) : byName(a, b);
      return ascending ? order : -order;
    });
  const visible = term ? items.filter((i) => fullName(i).toLowerCase().includes(term)) : items;
  // Only the owner gets students with no home branch (Decision 148.2); they
  // sit in their own group, not in the columns, until they have one.
  const noBranch = sorted(visible.filter((i) => i.noHomeBranch));
  const byColumn = (col: BoardColumn) => sorted(visible.filter((i) => !i.noHomeBranch && i.eligibility.boardColumn === col));
  // Only active students are graded up (Decision 283).
  const selectable = (i: GradingBoardItem) => !i.hardBlocked && i.active;
  const isSelected = (id: string) => selected.includes(id);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
      // Ticking opens the Selection panel unless a student's panel is open.
      if (next.length > 0 && !s.includes(id)) setPanel((p) => p ?? { kind: 'selection' });
      if (next.length === 0) setPanel((p) => (p?.kind === 'selection' ? null : p));
      return next;
    });
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
  const openItem = panel?.kind === 'student' ? items.find((i) => i.studentId === panel.studentId) ?? null : null;
  const showSelection = panel?.kind === 'selection' && canPromote && selectedItems.length > 0;
  const showPill = canPromote && selectedItems.length > 0 && !showSelection;
  const decidingItem = deciding ? items.find((i) => i.studentId === deciding) ?? null : null;

  const cardProps = (item: GradingBoardItem) => ({
    item,
    rung: ladder.find((r) => r.id === item.currentStripeId) ?? null,
    next: ladder.find((r) => r.id === item.eligibility.nextRungId) ?? null,
    selected: isSelected(item.studentId),
    open: openItem?.studentId === item.studentId,
    onOpen: () => setPanel({ kind: 'student', studentId: item.studentId }),
    onToggle: canPromote ? () => toggle(item.studentId) : undefined,
    onProgress: canPromote && item.active && item.feeStatus !== 'waiting' ? () => setPromotingOne({ item }) : undefined,
  });

  const columnRange = (key: BoardColumn) =>
    style
      ? key === 'JUST_STARTING'
        ? t('grading.board.rangeUnder', { percent: style.boardGettingThere })
        : key === 'GETTING_THERE'
          ? t('grading.board.rangeBetween', { from: style.boardGettingThere, to: style.boardReadyToGrade - 1 })
          : t('grading.board.rangeFrom', { percent: style.boardReadyToGrade })
      : null;

  const selectAll = (col: { key: BoardColumn; label: TranslationKey }, list: GradingBoardItem[]) => {
    const pickable = list.filter(selectable).map((i) => i.studentId);
    const allPicked = pickable.length > 0 && pickable.every(isSelected);
    return canPromote && pickable.length > 0 ? (
      <Checkbox
        label={t('grading.board.selectAll')}
        aria-label={t('grading.board.selectAllIn', { column: t(col.label) })}
        checked={allPicked}
        onChange={() => {
          setSelected((s) => (allPicked ? s.filter((id) => !pickable.includes(id)) : [...s, ...pickable.filter((id) => !s.includes(id))]));
          if (!allPicked) setPanel((p) => p ?? { kind: 'selection' });
        }}
      />
    ) : null;
  };

  const dropProps = (col: BoardColumn) => ({
    onDragOver: (e: React.DragEvent) => {
      if (canMove) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (!canMove) return;
      const item = items.find((i) => i.studentId === draggingId);
      setDraggingId(null);
      if (item && item.eligibility.boardColumn !== col) setMoving({ item, to: col });
    },
  });

  const sortLabel =
    sortKey === 'belt'
      ? ascending
        ? t('grading.board.sort.lowestFirst')
        : t('grading.board.sort.highestFirst')
      : ascending
        ? t('grading.board.sort.aToZ')
        : t('grading.board.sort.zToA');

  return (
    <div className={showPill ? 'ultm8-board--pill-space' : undefined}>
      <PageHeader title={t('grading.board.title')} subtitle={t('grading.board.subtitle')} />
      <GradingTabs />
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
                      setPanel(null);
                    }}
                    options={styles.map((d) => ({ value: d.id, label: d.name }))}
                  />
                </Field>
              </div>
              {pair ? (
                <div role="group" aria-label={t('grading.board.programLabel')} className="ultm8-view-toggle" style={{ alignSelf: 'flex-end' }}>
                  {(['kids', 'adult'] as const).map((which) => {
                    const target = pair[which];
                    const allowed = styles.some((d) => d.id === target.id);
                    return (
                      <Button
                        key={which}
                        type="button"
                        variant={target.id === disciplineId ? 'primary' : 'secondary'}
                        aria-pressed={target.id === disciplineId}
                        disabled={!allowed}
                        onClick={() => {
                          setDisciplineId(target.id);
                          setSelected([]);
                          setExpanded([]);
                          setPanel(null);
                        }}
                      >
                        {which === 'kids' ? t('grading.board.programKids') : t('grading.board.programAdult')}
                      </Button>
                    );
                  })}
                </div>
              ) : null}
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
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              <ViewToggle value={view} onChange={setView} aria-label={t('grading.board.viewAria')} />
              <div className="ultm8-view-toggle" role="group" aria-label={t('grading.board.sort.aria')}>
                {(['belt', 'name'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`ultm8-view-toggle__btn${sortKey === key ? ' ultm8-view-toggle__btn--active' : ''}`}
                    aria-pressed={sortKey === key}
                    onClick={() => {
                      setSortKey(key);
                      setAscending(true);
                    }}
                  >
                    {key === 'belt' ? t('grading.board.sort.belt') : t('grading.board.sort.name')}
                  </button>
                ))}
              </div>
              <Button variant="secondary" onClick={() => setAscending((a) => !a)} aria-label={t('grading.board.sort.directionAria', { direction: sortLabel })}>
                {sortLabel}
              </Button>
              <div style={{ flex: 1 }} />
              {canPromote && selectedItems.length > 0 ? (
                <Button variant="secondary" onClick={() => setPanel({ kind: 'selection' })} aria-label={t('grading.board.selection.openAria', { count: selectedItems.length })}>
                  {t('grading.board.selectedCount', { count: selectedItems.length })} ▸
                </Button>
              ) : null}
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
          </Card>

          {board.isLoading || ranks.isLoading ? (
            <Spinner />
          ) : board.error ? (
            <ErrorBanner message={board.error instanceof ApiError ? board.error.message : t('grading.board.loadBoardFailed')} />
          ) : (
            <div className={`ultm8-board-layout${openItem || showSelection ? ' ultm8-board-layout--with-panel' : ''}`}>
              <div style={{ minWidth: 0 }}>
                {noBranch.length > 0 && schoolId ? (
                  <section aria-label={t('grading.board.noBranch')} className="ultm8-board-tray" style={{ marginBottom: 16 }}>
                    <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: '0 0 4px' }}>
                      {t('grading.board.noBranch')} <Badge>{noBranch.length}</Badge>
                    </h2>
                    <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
                      {t('grading.board.noBranchHint')}
                    </p>
                    <ul
                      style={{
                        listStyle: 'none',
                        padding: 0,
                        margin: 0,
                        display: 'grid',
                        gap: 10,
                        gridTemplateColumns: view === 'grid' ? 'repeat(auto-fill, minmax(260px, 1fr))' : '1fr',
                      }}
                    >
                      {shown('NO_BRANCH', noBranch).map((item) =>
                        view === 'grid' ? (
                          <BoardCard key={item.studentId} {...cardProps(item)} onDragStart={() => setDraggingId(null)} footer={<AssignHomeBranch schoolId={schoolId} item={item} />} />
                        ) : (
                          <BoardRow key={item.studentId} {...cardProps(item)} footer={<AssignHomeBranch schoolId={schoolId} item={item} />} />
                        ),
                      )}
                    </ul>
                    {showAll('NO_BRANCH', noBranch.length)}
                  </section>
                ) : null}
                {view === 'grid' ? (
                  <div className="ultm8-board-columns">
                    {COLUMNS.map((col) => {
                      const list = byColumn(col.key);
                      return (
                        <section key={col.key} aria-label={t(col.label)} className="ultm8-board-tray" {...dropProps(col.key)}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                            <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
                              {t(col.label)} <Badge>{list.length}</Badge>
                              <span className="ultm8-field__hint" style={{ fontWeight: 400, marginLeft: 6 }}>
                                {columnRange(col.key)}
                              </span>
                            </h2>
                            {selectAll(col, list)}
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
                                  {...cardProps(item)}
                                  onMove={canMove ? () => setMoving({ item }) : undefined}
                                  onDragStart={() => setDraggingId(item.studentId)}
                                />
                              ))}
                            </ul>
                          )}
                          {showAll(col.key, list.length)}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  // Rows: Ready to Grade on top (DESIGN.md → "Grid or Rows").
                  [...COLUMNS].reverse().map((col) => {
                    const list = byColumn(col.key);
                    return (
                      <section key={col.key} aria-label={t(col.label)} className={`ultm8-board-group ultm8-board-group--${LEVEL_CLASS[col.key]}`} {...dropProps(col.key)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                          <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
                            {t(col.label)} <Badge>{list.length}</Badge>
                            <span className="ultm8-field__hint" style={{ fontWeight: 400, marginLeft: 6 }}>
                              {columnRange(col.key)}
                            </span>
                          </h2>
                          {selectAll(col, list)}
                        </div>
                        {list.length === 0 ? (
                          <p className="ultm8-field__hint" style={{ margin: 0 }}>
                            {t('grading.board.noStudentsHere')}
                          </p>
                        ) : (
                          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                            {shown(col.key, list).map((item) => (
                              <BoardRow key={item.studentId} {...cardProps(item)} onMove={canMove ? () => setMoving({ item }) : undefined} />
                            ))}
                          </ul>
                        )}
                        {showAll(col.key, list.length)}
                      </section>
                    );
                  })
                )}
              </div>
              {openItem && disciplineId ? (
                <aside className="ultm8-board-panel">
                  <StudentPanel
                    key={openItem.studentId}
                    item={openItem}
                    schoolId={schoolId}
                    disciplineId={disciplineId}
                    ladder={ladder}
                    isOwner={my.isOwner}
                    canPromote={canPromote}
                    fee={fee}
                    performerName={performerName}
                    onPromote={(targetRungId) => setPromotingOne({ item: openItem, targetRungId })}
                    onDecide={() => setDeciding(openItem.studentId)}
                    onClose={() => setPanel(selectedItems.length > 0 ? { kind: 'selection' } : null)}
                  />
                </aside>
              ) : showSelection ? (
                <aside className="ultm8-board-panel">
                  <SelectionPanel
                    items={selectedItems}
                    ladder={ladder}
                    hiddenCount={hiddenSelected}
                    onShowHidden={() => {
                      setSearch('');
                      setActiveOnly(false);
                    }}
                    onOpen={(id) => setPanel({ kind: 'student', studentId: id })}
                    onRemove={(id) => toggle(id)}
                    onPromote={() => setPromoting(true)}
                    onClear={() => {
                      setSelected([]);
                      setPanel(null);
                    }}
                    onMinimise={() => setPanel(null)}
                  />
                </aside>
              ) : null}
            </div>
          )}
        </>
      )}

      {showPill ? (
        <div className="ultm8-selection-pill" role="region" aria-label={t('grading.board.selection.pillAria')}>
          <Button variant="secondary" onClick={() => setPanel({ kind: 'selection' })}>
            {t('grading.board.selectedCount', { count: selectedItems.length })} ▴
          </Button>
          <Button onClick={() => setPromoting(true)}>{t('grading.board.selection.pillPromote')}</Button>
        </div>
      ) : null}

      {moving && disciplineId ? <MoveDialog disciplineId={disciplineId} item={moving.item} initialTo={moving.to} onClose={() => setMoving(null)} /> : null}
      {editingThresholds && style ? <ThresholdsDialog style={style} onClose={() => setEditingThresholds(false)} /> : null}
      {promoting && style && schoolId ? (
        <BulkPromoteModal
          schoolId={schoolId}
          style={style}
          ladder={ladder}
          adult={bulkAdultProgram}
          students={selectedItems}
          onRemove={(id) => setSelected((s) => s.filter((x) => x !== id))}
          onDone={() => {
            setSelected([]);
            setPanel((p) => (p?.kind === 'selection' ? null : p));
          }}
          onClose={() => setPromoting(false)}
        />
      ) : null}
      {promotingOne && style ? (
        <GradeModal
          studentId={promotingOne.item.studentId}
          discipline={style}
          ladder={ladder}
          current={ladder.find((r) => r.id === promotingOne.item.currentStripeId) ?? null}
          eligibility={promotingOne.item.eligibility}
          title={t('grading.board.promoteOneTitle', { name: fullName(promotingOne.item) })}
          initialTargetId={promotingOne.targetRungId}
          adult={adultProgram}
          onClose={() => setPromotingOne(null)}
        />
      ) : null}
      {decidingItem?.feeRequest ? (
        <DecideDialog
          name={fullName(decidingItem)}
          firstName={decidingItem.firstName}
          rank={feeRankName(decidingItem.feeRequest, t)}
          from={ladder.find((r) => r.id === decidingItem.currentStripeId) ?? null}
          to={ladder.find((r) => r.id === decidingItem.feeRequest!.toRungId) ?? null}
          canPromote={canPromote}
          onPromote={() => {
            setDeciding(null);
            setPromotingOne({ item: decidingItem, targetRungId: decidingItem.feeRequest!.toRungId });
          }}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </div>
  );
}

/** A progress bar that opens the promote dialog for that one student (DESIGN.md
 * → "Click a progress bar to promote"), in its board level's colour. */
function ProgressBar({ item, onProgress }: { item: GradingBoardItem; onProgress?: () => void }) {
  const t = useT();
  const name = fullName(item);
  const percent = item.eligibility.progressPercent ?? 0;
  const level = LEVEL_CLASS[item.eligibility.boardColumn ?? 'JUST_STARTING'];
  const bar = (
    <span
      role="progressbar"
      aria-label={t('grading.board.card.progressAria', { name })}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="ultm8-progress-track"
    >
      <span className={`ultm8-progress-fill ultm8-progress-fill--${level}`} style={{ width: `${percent}%` }} />
    </span>
  );
  return onProgress ? (
    <button
      type="button"
      className="ultm8-progress-button"
      onClick={(e) => {
        e.stopPropagation();
        onProgress();
      }}
      aria-label={t('grading.board.card.promoteFromBarAria', { name })}
      title={t('grading.board.card.promoteFromBarAria', { name })}
    >
      {bar}
    </button>
  ) : (
    <span style={{ display: 'block', padding: '3px 0' }}>{bar}</span>
  );
}

function Tags({ item }: { item: GradingBoardItem }) {
  const t = useT();
  const e = item.eligibility;
  const skillsMissing = !e.timeOnly && e.skillsOk === false;
  const daysShort = e.daysOk === false ? (e.requiredDays ?? 0) - (e.elapsedDays ?? 0) : 0;
  return (
    <>
      <FeeTag item={item} />
      {e.eligible && item.feeStatus !== 'waiting' ? <Badge variant="success">{t('grading.board.card.ready')}</Badge> : null}
      {item.hardBlocked ? <Badge variant="danger">{t('grading.board.card.skillsRequired')}</Badge> : skillsMissing ? <Badge variant="accent">{t('grading.board.card.skillsNotSignedOff')}</Badge> : null}
      {daysShort > 0 ? <Badge variant="accent">{t('grading.board.card.daysShort', { count: daysShort })}</Badge> : null}
      {item.active ? null : <Badge>{t('grading.board.card.inactive')}</Badge>}
      {item.verificationStatus === 'UNVERIFIED' ? <Badge variant="danger">{t('grading.board.card.notVerified')}</Badge> : null}
      {item.readyForAdult ? <Badge variant="info">{t('grading.board.card.readyForAdult')}</Badge> : null}
    </>
  );
}

interface CardProps {
  item: GradingBoardItem;
  rung: Rung | null;
  next: Rung | null;
  selected: boolean;
  /** This student's panel is open. */
  open: boolean;
  onOpen: () => void;
  /** Absent when the caller may not promote in this style. */
  onToggle?: () => void;
  /** Absent when the caller may not promote this student now. */
  onProgress?: () => void;
  /** Absent when the caller may not adjust progress in this style. */
  onMove?: () => void;
  /** Extra controls under the card, e.g. assigning a home branch. */
  footer?: React.ReactNode;
}

/** A click on the card (not on its tick box, link or buttons) opens the panel. */
const openOnClick = (onOpen: () => void) => (e: React.MouseEvent) => {
  if ((e.target as HTMLElement).closest('a, button, input, select, label, textarea')) return;
  onOpen();
};

function TickBox({ item, selected, onToggle }: { item: GradingBoardItem; selected: boolean; onToggle: () => void }) {
  const t = useT();
  const name = fullName(item);
  return (
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
  );
}

function BoardCard({ item, rung, selected, open, onOpen, onToggle, onProgress, onMove, onDragStart, footer }: CardProps & { onDragStart: () => void }) {
  const t = useT();
  const name = fullName(item);
  const percent = item.eligibility.progressPercent ?? 0;
  return (
    <li
      draggable={!!onMove}
      onDragStart={(ev) => {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', item.studentId);
        onDragStart();
      }}
      onClick={openOnClick(onOpen)}
      aria-label={name}
      aria-current={open ? 'true' : undefined}
      className={`ultm8-board-card${open ? ' ultm8-board-card--open' : ''}${selected ? ' ultm8-board-card--ticked' : ''}`}
      style={{ cursor: onMove ? 'grab' : 'pointer', opacity: item.active ? 1 : 0.7 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onToggle ? <TickBox item={item} selected={selected} onToggle={onToggle} /> : null}
        <Avatar person={item} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/students/${item.studentId}`} state={{ name }} style={{ fontWeight: 700 }}>
            {name}
          </Link>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: percent >= 100 ? '#3a7556' : undefined }}>{percent}%</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 4px' }}>
        {rung ? <BeltChip rung={rung} /> : null}
        <span className="ultm8-field__hint">{rung?.name ?? t('grading.board.card.rankNotOnLadder')}</span>
      </div>
      <ProgressBar item={item} onProgress={onProgress} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
        <Tags item={item} />
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

/** One student in Rows (DESIGN.md → "Grid or Rows"): tick box, avatar and
 * name, the belt with "→ next rank", the progress bar with the %, the tags,
 * and Move. */
function BoardRow({ item, rung, next, selected, open, onOpen, onToggle, onProgress, onMove, footer }: CardProps) {
  const t = useT();
  const name = fullName(item);
  const percent = item.eligibility.progressPercent ?? 0;
  return (
    <li
      onClick={openOnClick(onOpen)}
      aria-label={name}
      aria-current={open ? 'true' : undefined}
      className={`ultm8-board-card${open ? ' ultm8-board-card--open' : ''}${selected ? ' ultm8-board-card--ticked' : ''}`}
      style={{ opacity: item.active ? 1 : 0.7 }}
    >
      <div className="ultm8-board-row">
        <span>{onToggle ? <TickBox item={item} selected={selected} onToggle={onToggle} /> : null}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Avatar person={item} size={40} />
          <div style={{ minWidth: 0 }}>
            <Link to={`/students/${item.studentId}`} state={{ name }} style={{ fontWeight: 700 }}>
              {name}
            </Link>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <Tags item={item} />
            </div>
          </div>
        </div>
        <div className="ultm8-board-row__belt" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {rung ? <BeltChip rung={rung} /> : null}
            <span>{rung?.name ?? t('grading.board.card.rankNotOnLadder')}</span>
          </div>
          {next ? <div className="ultm8-field__hint">→ {next.name}</div> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <ProgressBar item={item} onProgress={onProgress} />
          </div>
          <strong style={{ color: percent >= 100 ? '#3a7556' : undefined }}>{percent}%</strong>
        </div>
        <div className="ultm8-board-row__actions">
          {onMove ? (
            <Button variant="secondary" onClick={onMove} aria-label={t('grading.board.card.moveAria', { name })}>
              {t('grading.board.card.move')}
            </Button>
          ) : null}
        </div>
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
            options={[{ value: '', label: t('grading.board.assign.placeholder') }, ...branchSelectOptions(branches.data?.items ?? [], t('branches.archivedBadge'))]}
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
