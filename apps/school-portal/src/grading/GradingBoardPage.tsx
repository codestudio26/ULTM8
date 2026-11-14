import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Checkbox, EmptyState, ErrorBanner, Field, Modal, ModalActions, Spinner, TextField, ViewToggle, type ViewMode } from '@ultm8/ui';
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
import { useGradingHeaderTabs } from './GradingTabs';
import { NewLookSelect } from '../layout/NewLookSelect';
import { StyleSwitch } from './StyleSwitch';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { BillingCard } from '../billing/BillingLook';
import './gradingDialogs.css';
import './gradingBoard.css';
import { Avatar, DecideDialog, FeeTag, SelectionPanel, StudentPanel, fullName } from './BoardPanels';
import { feeRankName } from './feeRank';
import { programPair, useAdultProgram } from './adultProgram';
import { mayCloseFee } from './feeAccess';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { fromGradingBoard } from './studentPageState';

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
 *
 * New look (Decision 460): the new page header with the Grading tabs, white
 * cards, our own drop-down for a student's home branch, and the new look's
 * pills, tick boxes and tags (gradingBoard.css). The style is picked with the
 * style switch, and "Currently attending only" is an on/off switch (Decision
 * 462 items 11 and 12). Same filters, sort, selection, columns and actions
 * as before.
 */
export function GradingBoardPage() {
  const schoolId = useGradingSchoolId();
  const { claims } = useAuth();
  const disciplines = useDisciplines(schoolId);
  const my = useMyGrading(schoolId);
  // Decision 420 item 2: staff with "Can cancel charges" waive or cancel fees too.
  const staffAccess = useMyStaffAccess(schoolId && !my.isOwner ? schoolId : null);
  const feeSettings = usePromotionFeeSettings(schoolId);
  const instructors = useInstructors(schoolId);
  const t = useT();
  const headerTabs = useGradingHeaderTabs();
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
      <div className="u8gb-show-all">
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
    <div className={`u8b u8gb${showPill ? ' ultm8-board--pill-space' : ''}`}>
      <NewLookPageHeader title={t('grading.board.title')} subtitle={t('grading.board.subtitle')} {...headerTabs} />
      {styles.length === 0 ? (
        <BillingCard>
          {my.isOwner ? (
            <EmptyState title={t('grading.noStylesTitle')} description={t('grading.board.noStylesDescription')} />
          ) : (
            <EmptyState title={t('grading.noStylesToGradeTitle')} description={t('grading.noStylesToGradeDescription')} />
          )}
        </BillingCard>
      ) : (
        <>
          <BillingCard>
            <div className="u8gb-tools">
              <StyleSwitch
                styles={styles}
                value={disciplineId}
                onChange={(id) => {
                  setDisciplineId(id);
                  setSelected([]);
                  setExpanded([]);
                  setPanel(null);
                }}
              />
              {pair ? (
                <div role="group" aria-label={t('grading.board.programLabel')} className="ultm8-view-toggle u8gb-switch">
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
              <div className="u8gb-search">
                <Field label={t('grading.board.searchLabel')} htmlFor="board-search">
                  <TextField type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
                </Field>
              </div>
              <div className="u8gb-check">
                {/* Decision 462 item 12: an on/off switch, the track before its words, as the design draws it. */}
                <button type="button" role="switch" aria-checked={activeOnly} className="u8gb-att" onClick={() => setActiveOnly((on) => !on)}>
                  <span className={`ultm8-switch${activeOnly ? ' ultm8-switch--on' : ''}`} aria-hidden="true">
                    <span className="ultm8-switch__knob" />
                  </span>
                  {t('grading.board.activeOnly')}
                </button>
                {activeOnly && board.data && board.data.hiddenInactive > 0 ? (
                  <span className="u8gb-hint"> {t('grading.board.inactiveHidden', { count: board.data.hiddenInactive })}</span>
                ) : null}
                {board.data && board.data.atTopRank > 0 ? (
                  <span className="u8gb-hint"> {t('grading.board.atTopRank', { count: board.data.atTopRank })}</span>
                ) : null}
              </div>
              {style ? (
                <div className="u8gb-percent">
                  <span className="u8gb-hint">
                    {t('grading.board.columnsAt', { gettingThere: style.boardGettingThere, readyToGrade: style.boardReadyToGrade })}
                  </span>
                  {my.can(style.id, 'canChangeBoardThresholds') ? (
                    <Button variant="secondary" className="u8gb-pill--small" onClick={() => setEditingThresholds(true)}>
                      {t('grading.board.changePercent')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="u8gb-tools u8gb-tools--views">
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
              <Button variant="secondary" className="u8gb-pill--small" onClick={() => setAscending((a) => !a)} aria-label={t('grading.board.sort.directionAria', { direction: sortLabel })}>
                {sortLabel}
              </Button>
              <div className="u8gb-tools__gap" />
              {canPromote && selectedItems.length > 0 ? (
                <Button variant="secondary" className="u8gb-pill--small" onClick={() => setPanel({ kind: 'selection' })} aria-label={t('grading.board.selection.openAria', { count: selectedItems.length })}>
                  {t('grading.board.selectedCount', { count: selectedItems.length })} ▸
                </Button>
              ) : null}
              {canPromote && hiddenSelected > 0 ? (
                <span className="u8gb-hint">
                  {t('grading.board.hiddenBySearch', { count: hiddenSelected })}{' '}
                  <Button variant="secondary" className="u8gb-pill--small" onClick={() => setSearch('')}>
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
          </BillingCard>

          {board.isLoading || ranks.isLoading ? (
            <Spinner />
          ) : board.error ? (
            <ErrorBanner message={board.error instanceof ApiError ? board.error.message : t('grading.board.loadBoardFailed')} />
          ) : (
            <div className={`ultm8-board-layout${openItem || showSelection ? ' ultm8-board-layout--with-panel' : ''}`}>
              <div className="u8gb-board">
                {noBranch.length > 0 && schoolId ? (
                  <section aria-label={t('grading.board.noBranch')} className="u8gb-no-branch">
                    <h2 className="u8gb-stage__title">
                      {t('grading.board.noBranch')} <Badge variant="warning">{noBranch.length}</Badge>
                    </h2>
                    <p className="u8gb-hint u8gb-no-branch__hint">{t('grading.board.noBranchHint')}</p>
                    <ul className={`u8gb-cards${view === 'grid' ? ' u8gb-cards--grid' : ''}`}>
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
                          <div className="u8gb-stage__head">
                            <h2 className="u8gb-stage__title">
                              {t(col.label)} <Badge>{list.length}</Badge>
                              <span className="u8gb-hint u8gb-stage__range">{columnRange(col.key)}</span>
                            </h2>
                            {selectAll(col, list)}
                          </div>
                          {list.length === 0 ? (
                            <p className="u8gb-hint u8gb-stage__empty">{t('grading.board.noStudentsHere')}</p>
                          ) : (
                            <ul className="u8gb-cards">
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
                        <div className="u8gb-stage__head">
                          <h2 className="u8gb-stage__title">
                            {t(col.label)} <Badge>{list.length}</Badge>
                            <span className="u8gb-hint u8gb-stage__range">{columnRange(col.key)}</span>
                          </h2>
                          {selectAll(col, list)}
                        </div>
                        {list.length === 0 ? (
                          <p className="u8gb-hint u8gb-stage__empty u8gb-stage__empty--row">{t('grading.board.noStudentsHere')}</p>
                        ) : (
                          <ul className="u8gb-cards u8gb-cards--rows">
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
                    mayCloseFee={mayCloseFee(my.isOwner, staffAccess.data)}
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
    <span className="u8gb-bar">{bar}</span>
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
      {/* Decision 321: too young for the next rank, and given automatically. */}
      {e.waitingForAge ? <Badge variant="warning">{t('grading.student.progress.waitingForAge', { age: e.waitingForAge })}</Badge> : null}
      {item.automaticNext ? <Badge variant="info">{t('grading.board.card.automatic')}</Badge> : null}
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

/** A click on the card (not on its tick box, link, buttons or drop-down) opens the panel. */
const openOnClick = (onOpen: () => void) => (e: React.MouseEvent) => {
  if ((e.target as HTMLElement).closest('a, button, input, select, label, textarea, .u8n-select')) return;
  onOpen();
};

function TickBox({ item, selected, onToggle }: { item: GradingBoardItem; selected: boolean; onToggle: () => void }) {
  const t = useT();
  const name = fullName(item);
  return (
    <input
      type="checkbox"
      className="u8gb-tick"
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
      className={`ultm8-board-card${open ? ' ultm8-board-card--open' : ''}${selected ? ' ultm8-board-card--ticked' : ''}${onMove ? ' u8gb-card--drag' : ''}${item.active ? '' : ' u8gb-card--inactive'}`}
    >
      <div className="u8gb-card__top">
        {onToggle ? <TickBox item={item} selected={selected} onToggle={onToggle} /> : null}
        <Avatar person={item} size={40} />
        <div className="u8gb-card__name">
          <Link to={`/students/${item.studentId}?tab=ranks`} state={fromGradingBoard(name)}>
            {name}
          </Link>
        </div>
        <div className={`u8gb-card__pct${percent >= 100 ? ' u8gb-pct--full' : ''}`}>{percent}%</div>
      </div>
      <div className="u8gb-card__belt">
        {rung ? <BeltChip rung={rung} /> : null}
        <span className="u8gb-hint">{rung?.name ?? t('grading.board.card.rankNotOnLadder')}</span>
      </div>
      <ProgressBar item={item} onProgress={onProgress} />
      <div className="u8gb-card__tags">
        <Tags item={item} />
        <span className="u8gb-card__gap" />
        {onMove ? (
          <Button variant="secondary" className="u8gb-pill--small" onClick={onMove} aria-label={t('grading.board.card.moveAria', { name })}>
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
      className={`ultm8-board-card${open ? ' ultm8-board-card--open' : ''}${selected ? ' ultm8-board-card--ticked' : ''}${item.active ? '' : ' u8gb-card--inactive'}`}
    >
      <div className="ultm8-board-row">
        <span>{onToggle ? <TickBox item={item} selected={selected} onToggle={onToggle} /> : null}</span>
        <div className="u8gb-row__who">
          <Avatar person={item} size={40} />
          <div className="u8gb-card__name">
            <Link to={`/students/${item.studentId}?tab=ranks`} state={fromGradingBoard(name)}>
              {name}
            </Link>
            <div className="u8gb-row__tags">
              <Tags item={item} />
            </div>
          </div>
        </div>
        <div className="ultm8-board-row__belt u8gb-row__belt">
          <div className="u8gb-card__belt">
            {rung ? <BeltChip rung={rung} /> : null}
            <span>{rung?.name ?? t('grading.board.card.rankNotOnLadder')}</span>
          </div>
          {next ? <div className="u8gb-hint">→ {next.name}</div> : null}
        </div>
        <div className="u8gb-row__progress">
          <div className="u8gb-row__bar">
            <ProgressBar item={item} onProgress={onProgress} />
          </div>
          <strong className={percent >= 100 ? 'u8gb-pct--full' : undefined}>{percent}%</strong>
        </div>
        <div className="ultm8-board-row__actions">
          {onMove ? (
            <Button variant="secondary" className="u8gb-pill--small" onClick={onMove} aria-label={t('grading.board.card.moveAria', { name })}>
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
    <div className="u8gb-assign">
      <div className="u8n-dd-field">
        <NewLookSelect
          id={id}
          label={t('grading.board.assign.label', { name })}
          value={branchId}
          onChange={setBranchId}
          options={[{ value: '', label: t('grading.board.assign.placeholder') }, ...branchSelectOptions(branches.data?.items ?? [], t('branches.archivedBadge'))]}
        />
      </div>
      <Button
        className="u8gb-pill--small"
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
        <div className="u8n-dd-field">
          <NewLookSelect
            id="move-to"
            label={t('grading.board.moveDialog.toLabel')}
            value={to}
            onChange={(v) => setTo(v as BoardColumn)}
            options={others.map((c) => ({ value: c.key, label: t(c.label) }))}
          />
        </div>
        <p className="ultm8-field__hint">
          {item.eligibility.timeOnly
            ? t('grading.board.moveDialog.hintTimeOnly', { column: label ?? '' })
            : t('grading.board.moveDialog.hintClasses', { column: label ?? '' })}
        </p>
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={move.isPending}>
            {t('grading.board.moveDialog.submit')}
          </Button>
        </ModalActions>
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
        <p className="ultm8-field__hint u8gd-summary">{t('grading.board.thresholds.explanation')}</p>
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
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
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
          <Button type="submit" loading={set.isPending} disabled={!valid}>
            {t('common.save')}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
