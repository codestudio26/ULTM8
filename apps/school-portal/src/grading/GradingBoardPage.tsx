import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Modal, PageHeader, SelectField, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useDisciplines } from '../disciplines/disciplineQueries';
import { useRanks } from '../ranks/rankQueries';
import { BeltChip } from './BeltChip';
import { flattenLadder, type Rung } from './ladder';
import { type BoardColumn, type GradingBoardItem, useBoardMove, useGradingBoard } from './gradingQueries';
import { BulkPromoteModal } from './BulkPromoteModal';

export const COLUMNS: Array<{ key: BoardColumn; label: string }> = [
  { key: 'JUST_STARTING', label: 'Just Starting' },
  { key: 'GETTING_THERE', label: 'Getting There' },
  { key: 'READY_TO_GRADE', label: 'Ready to Grade' },
];

export const fullName = (i: { firstName: string; surname: string }) => `${i.firstName} ${i.surname}`.trim();

/**
 * Grading Board (roadmap Phase 4, item 3; Decisions 128, 130, 136, 152, 176):
 * every student with a next rank in one style, in three columns by progress
 * (33% / 66% by default; per-school thresholds come with the grading
 * settings). Search, "currently attending only", tick students and promote
 * them together, and move a student to another column by dragging the card
 * or with its Move button — after a confirmation, since it rewrites their
 * progress and is recorded on their history.
 */
export function GradingBoardPage() {
  const schoolId = useOwnedSchoolId();
  const disciplines = useDisciplines(schoolId);
  const styles = disciplines.data?.items ?? [];
  const [disciplineId, setDisciplineId] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [moving, setMoving] = useState<{ item: GradingBoardItem; to?: BoardColumn } | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    if (!disciplineId && styles.length > 0) setDisciplineId(styles[0].id);
  }, [disciplineId, styles]);

  const board = useGradingBoard(schoolId, disciplineId, activeOnly);
  const ranks = useRanks(disciplineId);
  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const style = styles.find((d) => d.id === disciplineId) ?? null;

  if (!schoolId) return null;
  if (disciplines.isLoading) return <Spinner />;
  if (disciplines.error) return <ErrorBanner message={disciplines.error instanceof ApiError ? disciplines.error.message : 'Could not load styles.'} />;

  const items = board.data?.items ?? [];
  const term = search.trim().toLowerCase();
  const visible = term ? items.filter((i) => fullName(i).toLowerCase().includes(term)) : items;
  const byColumn = (col: BoardColumn) => visible.filter((i) => i.eligibility.boardColumn === col);
  const selectable = (i: GradingBoardItem) => !i.hardBlocked;
  const isSelected = (id: string) => selected.includes(id);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  // Selected students still on the board, in the order they were ticked.
  const selectedItems = selected.map((id) => items.find((i) => i.studentId === id)).filter((i): i is GradingBoardItem => !!i && selectable(i));

  return (
    <>
      <PageHeader
        title="Grading Board"
        subtitle="Every student's progress toward their next rank. Tick students to promote them together, or move a student to another column to adjust their progress by hand."
      />
      {styles.length === 0 ? (
        <Card>
          <EmptyState title="No styles yet" description="Add a style and its ranks on the Disciplines page first." />
        </Card>
      ) : (
        <>
          <Card>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 180 }}>
                <Field label="Style" htmlFor="board-style">
                  <SelectField
                    value={disciplineId ?? ''}
                    onChange={(e) => {
                      setDisciplineId(e.target.value);
                      setSelected([]);
                    }}
                    options={styles.map((d) => ({ value: d.id, label: d.name }))}
                  />
                </Field>
              </div>
              <div style={{ minWidth: 200 }}>
                <Field label="Search students" htmlFor="board-search">
                  <TextField type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
                </Field>
              </div>
              <div style={{ paddingBottom: 12 }}>
                <Checkbox label="Currently attending only" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
                {activeOnly && board.data && board.data.hiddenInactive > 0 ? (
                  <span className="ultm8-field__hint"> {board.data.hiddenInactive} inactive hidden</span>
                ) : null}
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ paddingBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                {selectedItems.length > 0 ? <strong>{selectedItems.length} selected</strong> : null}
                <Button onClick={() => setPromoting(true)} disabled={selectedItems.length === 0}>
                  Promote selected
                </Button>
              </div>
            </div>
          </Card>

          {board.isLoading || ranks.isLoading ? (
            <Spinner />
          ) : board.error ? (
            <ErrorBanner message={board.error instanceof ApiError ? board.error.message : 'Could not load the board.'} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 16, alignItems: 'start' }}>
              {COLUMNS.map((col) => {
                const list = byColumn(col.key);
                const pickable = list.filter(selectable).map((i) => i.studentId);
                const allPicked = pickable.length > 0 && pickable.every(isSelected);
                return (
                  <section
                    key={col.key}
                    aria-label={col.label}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const item = items.find((i) => i.studentId === draggingId);
                      setDraggingId(null);
                      if (item && item.eligibility.boardColumn !== col.key) setMoving({ item, to: col.key });
                    }}
                  >
                    <Card>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
                          {col.label} <Badge>{list.length}</Badge>
                        </h2>
                        {pickable.length > 0 ? (
                          <Checkbox
                            label="Select all"
                            aria-label={`Select all in ${col.label}`}
                            checked={allPicked}
                            onChange={() =>
                              setSelected((s) => (allPicked ? s.filter((id) => !pickable.includes(id)) : [...s, ...pickable.filter((id) => !s.includes(id))]))
                            }
                          />
                        ) : null}
                      </div>
                      {list.length === 0 ? (
                        <p className="ultm8-field__hint" style={{ textAlign: 'center', padding: '16px 0' }}>
                          No students here
                        </p>
                      ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                          {list.map((item) => (
                            <BoardCard
                              key={item.studentId}
                              item={item}
                              rung={ladder.find((r) => r.id === item.currentStripeId) ?? null}
                              selected={isSelected(item.studentId)}
                              onToggle={() => toggle(item.studentId)}
                              onMove={() => setMoving({ item })}
                              onDragStart={() => setDraggingId(item.studentId)}
                            />
                          ))}
                        </ul>
                      )}
                    </Card>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {moving && disciplineId ? <MoveDialog disciplineId={disciplineId} item={moving.item} initialTo={moving.to} onClose={() => setMoving(null)} /> : null}
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
}: {
  item: GradingBoardItem;
  rung: Rung | null;
  selected: boolean;
  onToggle: () => void;
  onMove: () => void;
  onDragStart: () => void;
}) {
  const name = fullName(item);
  const e = item.eligibility;
  const percent = e.progressPercent ?? 0;
  const skillsMissing = !e.timeOnly && e.skillsOk === false;
  const daysShort = e.daysOk === false ? (e.requiredDays ?? 0) - (e.elapsedDays ?? 0) : 0;
  return (
    <li
      draggable
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
        cursor: 'grab',
        opacity: item.active ? 1 : 0.7,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="checkbox"
          checked={selected}
          disabled={item.hardBlocked}
          onChange={onToggle}
          aria-label={item.hardBlocked ? `${name} can't be selected: required skills not signed off` : `Select ${name}`}
          title={item.hardBlocked ? 'This style requires every skill for the next rank to be signed off first.' : undefined}
        />
        {rung ? <BeltChip rung={rung} /> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/students/${item.studentId}`} style={{ fontWeight: 700 }}>
            {name}
          </Link>
          <div className="ultm8-field__hint">{rung?.name ?? 'Rank not on the ladder'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: percent >= 100 ? 'var(--text-success)' : undefined }}>{percent}%</div>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={`${name}: progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        style={{ height: 4, borderRadius: 3, background: 'var(--color-neutral-200)', overflow: 'hidden', margin: '8px 0' }}
      >
        <div style={{ width: `${percent}%`, height: '100%', background: percent >= 66 ? 'var(--color-success)' : 'var(--fill-accent)' }} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {e.eligible ? <Badge variant="success">Ready</Badge> : null}
        {item.hardBlocked ? <Badge variant="danger">Skills required</Badge> : skillsMissing ? <Badge variant="accent">Skills not signed off</Badge> : null}
        {daysShort > 0 ? <Badge variant="accent">{daysShort} days short</Badge> : null}
        {item.active ? null : <Badge>Inactive</Badge>}
        {item.verificationStatus === 'UNVERIFIED' ? <Badge variant="danger">Not verified</Badge> : null}
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onMove} aria-label={`Move ${name} to another column`}>
          Move
        </Button>
      </div>
    </li>
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
  const label = COLUMNS.find((c) => c.key === to)?.label;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await move.mutateAsync({ studentId: item.studentId, column: to });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title={`Move ${fullName(item)}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Move to" htmlFor="move-to">
          <SelectField value={to} onChange={(e) => setTo(e.target.value as BoardColumn)} options={others.map((c) => ({ value: c.key, label: c.label }))} />
        </Field>
        <p className="ultm8-field__hint">
          {item.eligibility.timeOnly
            ? `This changes their time-at-rank start date so they land in "${label}".`
            : `This changes their class count so they land in "${label}".`}{' '}
          The change is recorded on their history.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={move.isPending}>
            Move
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
