import React, { useMemo, useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorBanner,
  PageHeader,
  RowActionsMenu,
  Spinner,
  SuccessBanner,
  ViewToggle,
  type ViewMode,
} from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { useInstructors, type InstructorResponse } from '../instructors/instructorQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useStudents } from '../students/studentQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { titleCase } from '../lib/text';
import {
  useArchiveTimetableSlot,
  useCreateTimetableSlot,
  useTimetableSlots,
  useUnarchiveTimetableSlot,
  useUpdateTimetableSlot,
  type TimetableSlotResponse,
} from './timetableQueries';
import { TimetableSlotFormModal } from './TimetableSlotFormModal';
import { TimetableBookingDialog } from './TimetableBookingDialog';
import {
  addDays,
  colorForSlot,
  endOfMonth,
  occurrencesForRange,
  startOfMonth,
  startOfWeek,
  WEEKDAY_ORDER,
  type DayOccurrences,
} from './timetableOccurrences';

type RangeMode = 'day' | 'week' | 'month';

// Plain label map, not `titleCase` — that helper upper-cases a SCREAMING_SNAKE_CASE
// enum's existing first letter (e.g. "MONDAY" -> "Monday"); 'day'/'week'/'month' are
// already-lowercase literals, so titleCase would pass them through unchanged.
const RANGE_MODE_LABELS: Record<RangeMode, string> = { day: 'Day', week: 'Week', month: 'Month' };

interface BookingTarget {
  slotId: string;
  slotTitle: string;
  date: string;
}

/**
 * Timetable page redesign — v1.2 backend backlog, "Timetable page (mockup —
 * click-to-book preview, Daily/Weekly/Monthly)". The backlog doc's own
 * "Blocking architectural gap" note is STALE as of this redesign: SKILL.md §9 is
 * `[CONFIRMED]` (resolved 24 Aug 2026, not `[UNRESOLVED]`) — a bookable Class is
 * either materialized ahead of time from an active TimetableSlot (the real,
 * running class-occurrence-generation job, 4 weeks ahead) or created as an
 * independent one-off; `Class`'s own `@@unique([timetableSlotId, occurrenceDate])`
 * gives a guaranteed-unique lookup. See this redesign's own PR description, and
 * `docs/v1.2-backend-backlog.md`'s corrected entry, for the full account.
 *
 * NO MOCKUP REACHABLE THIS SESSION (`Timetable.dc.html` lives only in an external
 * design-canvas tool outside this checkout) — designed fresh against the backlog
 * doc's own description of what was settled on, the same way DashboardPage.tsx was
 * designed fresh earlier this session. Two independent presentation dimensions,
 * per that doc:
 *  - Day/Week/Month — the TIME RANGE being viewed (`rangeMode` below), a new,
 *    page-specific 3-way control; not an existing shared component, since no
 *    other page in this app has a 3-way range switch to reuse.
 *  - Rows/Grid — the already-established `ViewToggle`/`CardGrid` LAYOUT toggle
 *    (Branches/Franchises/Classes/Students' own convention). Rows is the
 *    day-grouped agenda list; Grid reuses a Weekly-view look (day columns,
 *    left-border-colored cards).
 * DISCLOSED JUDGMENT CALL: Month always renders as a single calendar grid with
 * per-occurrence dots (the backlog doc's own explicit treatment for Monthly,
 * independent of Rows/Grid) — the Rows/Grid toggle is hidden while Month is
 * selected rather than inventing a second, redundant "Rows" rendering of a
 * month (e.g. 30 separate day-agenda Cards), which the doc never describes and
 * which would make the one Month-specific requirement ("dots") not apply to half
 * of it. See the PR description for the full reasoning.
 *
 * Every rendered occurrence across all three range modes gets a "Book" action
 * (agenda cards on Day/Week, a clickable dot on Month) — the click-to-book
 * confirmation dialog (TimetableBookingDialog.tsx) is unchanged by which range
 * mode or layout the click came from.
 */
export function TimetablePage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useTimetableSlots(schoolId);
  const { data: branchData } = useBranches(schoolId);
  const { data: instructorData } = useInstructors(schoolId);
  const { data: disciplineData } = useDisciplines(schoolId);
  const { data: studentData } = useStudents(schoolId);
  const createSlot = useCreateTimetableSlot(schoolId ?? '');
  const archiveSlot = useArchiveTimetableSlot(schoolId ?? '');
  const unarchiveSlot = useUnarchiveTimetableSlot(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TimetableSlotResponse | null>(null);
  const [rangeMode, setRangeMode] = useState<RangeMode>('week');
  const [viewMode, setViewMode] = useState<ViewMode>('rows');
  const [anchor, setAnchor] = useState(() => new Date());
  const [booking, setBooking] = useState<BookingTarget | null>(null);
  const [bookedMessage, setBookedMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Decision 226 — archived TimetableSlots are excluded by default (hidden
  // from the whole calendar — Day/Week agenda, Grid columns, and Month
  // dots alike), same "excluded by default, visible via a filter"
  // convention this build applies to every one of the 7 entities.
  const [showArchived, setShowArchived] = useState(false);

  // Must run on every render regardless of loading/error state — a hook can never
  // sit after a conditional early return (Rules of Hooks); see this page's own
  // prior incident comment (kept below on the memo it originally guarded).
  const allSlots = data?.items ?? [];
  const archivedCount = allSlots.filter((s) => s.archivedAt).length;
  const slots = showArchived ? allSlots : allSlots.filter((s) => !s.archivedAt);

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (rangeMode === 'day') {
      const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
      return { rangeStart: d, rangeEnd: d };
    }
    if (rangeMode === 'week') {
      const start = startOfWeek(anchor);
      return { rangeStart: start, rangeEnd: addDays(start, 6) };
    }
    return { rangeStart: startOfMonth(anchor), rangeEnd: endOfMonth(anchor) };
  }, [anchor, rangeMode]);

  // This used to come after the isLoading/error returns below, so it only ran
  // once data existed: the moment a render's hook count differed from the
  // previous one, React threw "Rendered more hooks than during the previous
  // render" with no error boundary anywhere in the tree to catch it — real users
  // saw a blank white screen instead of the loading spinner or even React's own
  // error overlay. occurrencesForRange below is the same kind of per-render
  // derived value and stays up here with the rest, for the same reason.
  const days = useMemo(() => occurrencesForRange(slots, rangeStart, rangeEnd), [slots, rangeStart, rangeEnd]);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load the Timetable.'} />;

  const branches = branchData?.items ?? [];
  const instructors = instructorData?.items ?? [];
  const disciplines = disciplineData?.items ?? [];
  const students = studentData?.items ?? [];
  const hasAnySlots = slots.length > 0;

  function shiftAnchor(direction: 1 | -1) {
    if (rangeMode === 'day') setAnchor((a) => addDays(a, direction));
    else if (rangeMode === 'week') setAnchor((a) => addDays(a, 7 * direction));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + direction, 1));
  }

  const rangeLabel =
    rangeMode === 'day'
      ? rangeStart.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : rangeMode === 'week'
        ? `${rangeStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${rangeEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
        : rangeStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <>
      <PageHeader
        title="Timetable"
        subtitle="The recurring weekly slot template — click any occurrence to book a Student into it."
        actions={<Button onClick={() => setCreating(true)}>Add slot</Button>}
      />

      {bookedMessage ? <SuccessBanner message={bookedMessage} /> : null}

      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="ultm8-view-toggle" role="group" aria-label="Date range">
              {(['day', 'week', 'month'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={['ultm8-view-toggle__btn', rangeMode === mode ? 'ultm8-view-toggle__btn--active' : ''].join(' ').trim()}
                  aria-pressed={rangeMode === mode}
                  onClick={() => setRangeMode(mode)}
                >
                  {RANGE_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => shiftAnchor(-1)}>
              ← Prev
            </Button>
            <Button variant="secondary" onClick={() => setAnchor(new Date())}>
              Today
            </Button>
            <Button variant="secondary" onClick={() => shiftAnchor(1)}>
              Next →
            </Button>
            <span style={{ fontWeight: 500 }}>{rangeLabel}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {/* Decision 226 — archived slots are hidden from the whole calendar by default. */}
            <Checkbox label={`Show archived${archivedCount ? ` (${archivedCount})` : ''}`} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            {rangeMode !== 'month' ? <ViewToggle value={viewMode} onChange={setViewMode} aria-label="Timetable view" /> : null}
          </div>
        </div>
      </Card>

      {actionError ? <ErrorBanner message={actionError} /> : null}

      {!hasAnySlots ? (
        <Card>
          <EmptyState title="No Timetable slots yet" description="Add your first weekly slot to get started." />
        </Card>
      ) : rangeMode === 'month' ? (
        <MonthGrid
          monthStart={rangeStart}
          days={days}
          onBook={(target) => setBooking(target)}
        />
      ) : viewMode === 'grid' ? (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto' }}>
          {days.map((day) => (
            <DayColumn key={day.date} day={day} branches={branches} onBook={setBooking} onEdit={setEditing} archiveSlot={archiveSlot} unarchiveSlot={unarchiveSlot} setActionError={setActionError} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {days.map((day) => (
            <DayAgendaCard key={day.date} day={day} branches={branches} onBook={setBooking} onEdit={setEditing} archiveSlot={archiveSlot} unarchiveSlot={unarchiveSlot} setActionError={setActionError} />
          ))}
        </div>
      )}

      {creating ? (
        <TimetableSlotFormModal
          title="Add timetable slot"
          branches={branches}
          instructors={instructors}
          disciplines={disciplines}
          submitting={createSlot.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's nulls back to
            // undefined (omitted), since CreateTimetableSlotDto doesn't
            // accept null on these fields.
            await createSlot.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditSlotModal schoolId={schoolId} branches={branches} instructors={instructors} disciplines={disciplines} slot={editing} onClose={() => setEditing(null)} />
      ) : null}

      {booking ? (
        <TimetableBookingDialog
          slotId={booking.slotId}
          slotTitle={booking.slotTitle}
          date={booking.date}
          students={students}
          instructors={instructors}
          onClose={() => setBooking(null)}
          onBooked={() => {
            setBooking(null);
            setBookedMessage(`Booked ${booking.slotTitle} on ${booking.date}.`);
          }}
        />
      ) : null}
    </>
  );
}

function branchLabel(branches: BranchResponse[], branchId: string | null | undefined) {
  return branches.find((b) => b.id === branchId)?.name ?? (branchId ? branchId : 'Whole School');
}

/** Decision 226 — shared shape for the archive/unarchive mutations every
 * occurrence-rendering component below forwards down to OccurrenceCard's
 * own RowActionsMenu, so a slot can be archived/unarchived from any
 * range mode or layout without duplicating the mutation wiring per
 * component. */
type ArchiveMutation = UseMutationResult<TimetableSlotResponse, unknown, string>;

/** One occurrence's agenda card — shared by the Rows day-sections and the Grid day
 * columns, so "Book"/"Edit slot" behave identically regardless of layout. An OFF
 * slot still renders (dimmed, no Book action) rather than disappearing — it has no
 * bookable occurrence, but Staff still need to find and re-enable it, and the old
 * weekday-grouped table was the only place this screen showed OFF slots at all. */
function OccurrenceCard({
  slot,
  date,
  branches,
  onBook,
  onEdit,
  archiveSlot,
  unarchiveSlot,
  setActionError,
}: {
  slot: TimetableSlotResponse;
  date: string;
  branches: BranchResponse[];
  onBook: (target: BookingTarget) => void;
  onEdit: (slot: TimetableSlotResponse) => void;
  archiveSlot: ArchiveMutation;
  unarchiveSlot: ArchiveMutation;
  setActionError: (message: string | null) => void;
}) {
  const isOn = slot.status === 'ON';
  const isArchived = !!slot.archivedAt;
  return (
    <div
      style={{
        borderLeft: `4px solid ${colorForSlot(slot)}`,
        borderRadius: 6,
        background: 'var(--fill-muted, #f5f5f5)',
        padding: '8px 12px',
        opacity: isOn && !isArchived ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <strong>{slot.title}</strong>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {slot.startTime} – {slot.endTime} · {branchLabel(branches, slot.branchId)}
          </div>
        </div>
        <RowActionsMenu
          label={`Actions for ${slot.title} on ${date}`}
          actions={[
            ...(isOn && !isArchived ? [{ label: 'Book', onClick: () => onBook({ slotId: slot.id, slotTitle: slot.title, date }) }] : []),
            { label: 'Edit slot', onClick: () => onEdit(slot) },
            // Decision 226 — School Owner/Manager only, idempotent, blocked
            // (409) by an upcoming Booking against a generated Class.
            isArchived
              ? { label: 'Unarchive', onClick: () => { setActionError(null); unarchiveSlot.mutate(slot.id, { onError: (err: unknown) => setActionError(err instanceof ApiError ? err.message : 'Could not unarchive this slot.') }); } }
              : { label: 'Archive', onClick: () => { setActionError(null); archiveSlot.mutate(slot.id, { onError: (err: unknown) => setActionError(err instanceof ApiError ? err.message : 'Could not archive this slot.') }); } },
          ]}
        />
      </div>
      <div style={{ marginTop: 6 }}>
        {slot.activities.map((a, i) => (
          <Badge key={`${a}-${i}`}>{a}</Badge>
        ))}
        {!isOn ? <Badge>Off</Badge> : null}
        {isArchived ? <Badge variant="default">Archived</Badge> : null}
      </div>
    </div>
  );
}

function dayHeading(day: DayOccurrences): string {
  const label = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return label;
}

function DayAgendaCard({
  day,
  branches,
  onBook,
  onEdit,
  archiveSlot,
  unarchiveSlot,
  setActionError,
}: {
  day: DayOccurrences;
  branches: BranchResponse[];
  onBook: (target: BookingTarget) => void;
  onEdit: (slot: TimetableSlotResponse) => void;
  archiveSlot: ArchiveMutation;
  unarchiveSlot: ArchiveMutation;
  setActionError: (message: string | null) => void;
}) {
  return (
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
        {dayHeading(day)}
      </h2>
      {day.slots.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Nothing scheduled.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {day.slots.map((slot) => (
            <OccurrenceCard key={slot.id} slot={slot} date={day.date} branches={branches} onBook={onBook} onEdit={onEdit} archiveSlot={archiveSlot} unarchiveSlot={unarchiveSlot} setActionError={setActionError} />
          ))}
        </div>
      )}
    </Card>
  );
}

function DayColumn({
  day,
  branches,
  onBook,
  onEdit,
  archiveSlot,
  unarchiveSlot,
  setActionError,
}: {
  day: DayOccurrences;
  branches: BranchResponse[];
  onBook: (target: BookingTarget) => void;
  onEdit: (slot: TimetableSlotResponse) => void;
  archiveSlot: ArchiveMutation;
  unarchiveSlot: ArchiveMutation;
  setActionError: (message: string | null) => void;
}) {
  return (
    <div style={{ minWidth: 220, flex: '1 0 220px' }}>
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 14, marginBottom: 8 }}>
          {dayHeading(day)}
        </h2>
        {day.slots.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: 13 }}>—</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {day.slots.map((slot) => (
              <OccurrenceCard key={slot.id} slot={slot} date={day.date} branches={branches} onBook={onBook} onEdit={onEdit} archiveSlot={archiveSlot} unarchiveSlot={unarchiveSlot} setActionError={setActionError} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** Monthly view — a real 7-column calendar grid (leading blanks so the 1st lands
 * under its real weekday), each day a dot per ON occurrence (the backlog doc's own
 * "dots on Monthly" treatment) — clicking a dot opens the same booking dialog as
 * every other view. OFF slots are intentionally not dotted here (nothing to book);
 * Day/Week agenda views remain where an OFF slot is visible/editable. */
function MonthGrid({ monthStart, days, onBook }: { monthStart: Date; days: DayOccurrences[]; onBook: (target: BookingTarget) => void }) {
  const leadingBlanks = WEEKDAY_ORDER.indexOf(days[0]?.weekday ?? 'MONDAY');
  return (
    <Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
        {WEEKDAY_ORDER.map((wd) => (
          <div key={wd} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' }}>
            {titleCase(wd).slice(0, 3)}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`blank-${i}`} />)}
        {days.map((day) => {
          const bookable = day.slots.filter((s) => s.status === 'ON');
          return (
            <div
              key={day.date}
              style={{
                minHeight: 72,
                border: '1px solid var(--border-subtle, #e2e2e2)',
                borderRadius: 6,
                padding: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(`${day.date}T00:00:00`).getDate()}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {bookable.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    title={`Book ${slot.title} — ${day.date}`}
                    aria-label={`Book ${slot.title} on ${day.date}`}
                    onClick={() => onBook({ slotId: slot.id, slotTitle: slot.title, date: day.date })}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      background: colorForSlot(slot),
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function EditSlotModal({
  schoolId,
  branches,
  instructors,
  disciplines,
  slot,
  onClose,
}: {
  schoolId: string;
  branches: BranchResponse[];
  instructors: InstructorResponse[];
  disciplines: DisciplineResponse[];
  slot: TimetableSlotResponse;
  onClose: () => void;
}) {
  const updateSlot = useUpdateTimetableSlot(schoolId, slot.id);
  return (
    <TimetableSlotFormModal
      title="Edit timetable slot"
      initial={slot}
      branches={branches}
      instructors={instructors}
      disciplines={disciplines}
      submitting={updateSlot.isPending}
      onSubmit={async (values) => {
        // Passed straight through, nulls included — UpdateTimetableSlotDto
        // accepts null on these fields to mean "clear it" (see
        // TimetableSlotFormValues' own header comment).
        await updateSlot.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
