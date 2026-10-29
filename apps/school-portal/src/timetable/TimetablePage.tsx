import React, { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  RowActionsMenu,
  SelectField,
  Spinner,
  SuccessBanner,
  ViewToggle,
  type ViewMode,
} from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { useInstructors, type InstructorResponse } from '../instructors/instructorQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useStudents } from '../students/studentQueries';
import { useSchool } from '../schools/schoolQueries';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { useI18n, useT, type TranslateFn, type TranslationKey } from '../i18n/I18nProvider';
import {
  useArchiveTimetableSlot,
  useCreateTimetableSlot,
  useTimetableCalendar,
  useTimetableSlots,
  useUnarchiveTimetableSlot,
  useUpdateTimetableSlot,
  fetchUpcomingImpact,
  type TimetableSlotResponse,
  type UpcomingImpactResponse,
  type UpdateTimetableSlotInput,
} from './timetableQueries';
import { TimetableSlotFormModal } from './TimetableSlotFormModal';
import { BookedClassesDialog, type BookedClassesMode } from './BookedClassesDialog';
import { changedSlotFields, slotChangeMovesClasses, slotChangeTouchesBookingRules } from './slotChanges';
import { TimetableBookingDialog } from './TimetableBookingDialog';
import { ClosuresDialog } from './ClosuresDialog';
import {
  addDays,
  colorForSlot,
  endOfMonth,
  occurrencesForRange,
  startOfMonth,
  startOfWeek,
  toDateKey,
  entryMatchesFilters,
  weekdaysFrom,
  weekdayName,
  type CalendarEntry,
  type DayOccurrences,
} from './timetableOccurrences';
import { formatLocale } from '../i18n/format';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';

type RangeMode = 'day' | 'week' | 'month';

// Plain label map, not `titleCase` — that helper upper-cases a SCREAMING_SNAKE_CASE
// enum's existing first letter (e.g. "MONDAY" -> "Monday"); 'day'/'week'/'month' are
// already-lowercase literals, so titleCase would pass them through unchanged.
const RANGE_MODE_LABELS: Record<RangeMode, TranslationKey> = {
  day: 'timetable.rangeDay',
  week: 'timetable.rangeWeek',
  month: 'timetable.rangeMonth',
};

interface BookingTarget {
  classId: string;
  title: string;
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
 * Decision 353 (T7, Q5): the calendar shows the real Classes on each date
 * (one-offs, moved and cancelled dates, seats taken), not the weekly template.
 * A Class that can still be booked gets a "Book" action (agenda cards on
 * Day/Week, a clickable dot on Month); a cancelled or ended one doesn't. An On
 * slot's dates past the 4-week horizon show as "Opens for booking later".
 *
 * Decision 353 (Q4): Branch Staff get this page too, read-only — their own
 * Branch's classes plus School-wide ones (the API scopes the calendar), with
 * Book and Open class but no Add/Edit/Archive slot. Only the owner edits slots.
 */
export function TimetablePage() {
  const t = useT();
  const { claims } = useAuth();
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  const isBranchStaff = !!claims?.grants.some((g) => g.role === 'BRANCH_STAFF' && g.schoolId === coachSchoolId);
  const schoolId = ownedSchoolId ?? (isBranchStaff ? coachSchoolId : null);
  // Decision 387 — Branch Staff with the "classes" switch edit their
  // branches' slots too; Closures and School-wide slots stay the owner's.
  const myAccess = useMyStaffAccess(isBranchStaff && !ownedSchoolId ? coachSchoolId : null);
  const isOwner = !!ownedSchoolId;
  const canEdit = isOwner || !!myAccess.data?.access.classes;
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useTimetableSlots(schoolId);
  const { data: branchData } = useBranches(schoolId);
  const { data: instructorData } = useInstructors(schoolId);
  // Archived styles too: the forms show one a record already has (Decision 310).
  const { data: disciplineData } = useDisciplines(schoolId, { includeArchived: true });
  const { data: studentData } = useStudents(schoolId);
  const { data: school } = useSchool(schoolId);
  const weekStartsOn = school?.weekStartsOn ?? 'MONDAY';
  const createSlot = useCreateTimetableSlot(schoolId ?? '');
  const archiveSlot = useArchiveTimetableSlot(schoolId ?? '');
  const unarchiveSlot = useUnarchiveTimetableSlot(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TimetableSlotResponse | null>(null);
  const [rangeMode, setRangeMode] = useState<RangeMode>('week');
  // Null until changed here: the School's default layout (Decision 319 §4).
  const [chosenViewMode, setViewMode] = useState<ViewMode | null>(null);
  // Decision 319 §1 filters: Branch, style and class type.
  const [branchFilter, setBranchFilter] = useState('');
  const [styleFilter, setStyleFilter] = useState('');
  const [classTypeFilter, setClassTypeFilter] = useState('');
  const viewMode: ViewMode = chosenViewMode ?? (school?.timetableDefaultLayout === 'GRID' ? 'grid' : 'rows');
  const [anchor, setAnchor] = useState(() => new Date());
  const [booking, setBooking] = useState<BookingTarget | null>(null);
  const [closuresOpen, setClosuresOpen] = useState(false);
  const [bookedMessage, setBookedMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Decision 226 — archived TimetableSlots are excluded by default (hidden
  // from the whole calendar — Day/Week agenda, Grid columns, and Month
  // dots alike), same "excluded by default, visible via a filter"
  // convention this build applies to every one of the 7 entities.
  const [showArchived, setShowArchived] = useState(false);
  // Decision 332 (T10) — archiving asks first, like Branches.
  const [archiving, setArchiving] = useState<TimetableSlotResponse | null>(null);

  // Must run on every render regardless of loading/error state — a hook can never
  // sit after a conditional early return (Rules of Hooks); see this page's own
  // prior incident comment (kept below on the memo it originally guarded).
  const allSlots = data?.items ?? [];
  const archivedCount = allSlots.filter((s) => s.archivedAt).length;
  const slots = showArchived && canEdit ? allSlots : allSlots.filter((s) => !s.archivedAt);

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (rangeMode === 'day') {
      const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
      return { rangeStart: d, rangeEnd: d };
    }
    if (rangeMode === 'week') {
      const start = startOfWeek(anchor, weekStartsOn);
      return { rangeStart: start, rangeEnd: addDays(start, 6) };
    }
    return { rangeStart: startOfMonth(anchor), rangeEnd: endOfMonth(anchor) };
  }, [anchor, rangeMode, weekStartsOn]);

  // This used to come after the isLoading/error returns below, so it only ran
  // once data existed: the moment a render's hook count differed from the
  // previous one, React threw "Rendered more hooks than during the previous
  // render" with no error boundary anywhere in the tree to catch it — real users
  // saw a blank white screen instead of the loading spinner or even React's own
  // error overlay. occurrencesForRange below is the same kind of per-render
  // derived value and stays up here with the rest, for the same reason.
  const calendar = useTimetableCalendar(schoolId, toDateKey(rangeStart), toDateKey(rangeEnd));
  const days = useMemo(() => {
    const all = occurrencesForRange(slots, calendar.data, rangeStart, rangeEnd);
    const keep = (e: CalendarEntry) => {
      // Off slots are only there for the owner to switch back on (Q4).
      if (!canEdit && e.kind === 'template') return false;
      const branchId = e.kind === 'class' ? e.cls.branchId : e.slot.branchId;
      // A Branch's timetable shows its own and School-wide classes (Decision 319 §1).
      if (branchFilter && branchId && branchId !== branchFilter) return false;
      return entryMatchesFilters(e.kind === 'class' ? e.cls.styles : e.slot.styles, styleFilter, classTypeFilter);
    };
    return all.map((day) => ({
      ...day,
      entries: day.entries.filter(keep),
      closures: branchFilter ? day.closures.filter((c) => !c.branchId || c.branchId === branchFilter) : day.closures,
    }));
  }, [slots, calendar.data, rangeStart, rangeEnd, canEdit, branchFilter, styleFilter, classTypeFilter]);
  const slotActions: SlotActions | null = canEdit
    ? { onEdit: setEditing, onArchive: setArchiving, unarchiveSlot, setActionError, mayChange: (s) => isOwner || !!s.branchId }
    : null;

  // Instructors have no Timetable screen (Decision 353 gave it to Branch Staff
  // only): send them home instead of a blank page, as the Staff page does.
  if (!schoolId) return <Navigate to="/" replace />;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('timetable.loadFailed')} />;
  if (calendar.error) return <ErrorBanner message={calendar.error instanceof ApiError ? calendar.error.message : t('timetable.loadFailed')} />;

  const branches = branchData?.items ?? [];
  const instructors = instructorData?.items ?? [];
  const disciplines = disciplineData?.items ?? [];
  const students = studentData?.items ?? [];
  const chosenStyle = disciplines.find((d) => d.id === styleFilter);
  const hasAnything = (canEdit ? slots.length > 0 : days.some((day) => day.entries.length > 0)) || (calendar.data?.classes.length ?? 0) > 0 || (calendar.data?.closures.length ?? 0) > 0;

  function shiftAnchor(direction: 1 | -1) {
    if (rangeMode === 'day') setAnchor((a) => addDays(a, direction));
    else if (rangeMode === 'week') setAnchor((a) => addDays(a, 7 * direction));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + direction, 1));
  }

  const rangeLabel =
    rangeMode === 'day'
      ? rangeStart.toLocaleDateString(formatLocale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : rangeMode === 'week'
        ? `${rangeStart.toLocaleDateString(formatLocale(), { month: 'short', day: 'numeric' })} – ${rangeEnd.toLocaleDateString(formatLocale(), { month: 'short', day: 'numeric', year: 'numeric' })}`
        : rangeStart.toLocaleDateString(formatLocale(), { month: 'long', year: 'numeric' });

  return (
    <>
      <PageHeader
        title={t('timetable.title')}
        subtitle={canEdit ? t('timetable.subtitle') : t('timetable.staffSubtitle')}
        actions={
          canEdit ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {isOwner ? (
                <Button variant="secondary" onClick={() => setClosuresOpen(true)}>
                  {t('timetable.closures.button')}
                </Button>
              ) : null}
              <Button onClick={() => setCreating(true)}>{t('timetable.addSlot')}</Button>
            </div>
          ) : undefined
        }
      />

      {bookedMessage ? <SuccessBanner message={bookedMessage} /> : null}

      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="ultm8-view-toggle" role="group" aria-label={t('timetable.rangeAria')}>
              {(['day', 'week', 'month'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={['ultm8-view-toggle__btn', rangeMode === mode ? 'ultm8-view-toggle__btn--active' : ''].join(' ').trim()}
                  aria-pressed={rangeMode === mode}
                  onClick={() => setRangeMode(mode)}
                >
                  {t(RANGE_MODE_LABELS[mode])}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => shiftAnchor(-1)}>
              {t('timetable.prev')}
            </Button>
            <Button variant="secondary" onClick={() => setAnchor(new Date())}>
              {t('timetable.today')}
            </Button>
            <Button variant="secondary" onClick={() => shiftAnchor(1)}>
              {t('timetable.next')}
            </Button>
            <span style={{ fontWeight: 500 }}>{rangeLabel}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {/* Decision 226 — archived slots are hidden from the whole calendar by default. */}
            {canEdit ? <Checkbox label={archivedCount ? t('timetable.showArchivedCount', { count: archivedCount }) : t('timetable.showArchived')} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> : null}
            {rangeMode !== 'month' ? <ViewToggle value={viewMode} onChange={setViewMode} aria-label={t('timetable.viewAria')} /> : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          {branches.length > 1 ? (
            <Field label={t('timetable.filters.branch')} htmlFor="tt-filter-branch">
              <SelectField
                id="tt-filter-branch"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                options={[{ value: '', label: t('timetable.filters.allBranches') }, ...branches.filter((b) => !b.archivedAt).map((b) => ({ value: b.id, label: b.name }))]}
              />
            </Field>
          ) : null}
          <Field label={t('timetable.filters.style')} htmlFor="tt-filter-style">
            <SelectField
              id="tt-filter-style"
              value={styleFilter}
              onChange={(e) => {
                setStyleFilter(e.target.value);
                setClassTypeFilter('');
              }}
              options={[{ value: '', label: t('timetable.filters.allStyles') }, ...disciplines.map((d) => ({ value: d.id, label: d.name }))]}
            />
          </Field>
          {chosenStyle && chosenStyle.classTypesOffered.length > 0 ? (
            <Field label={t('timetable.filters.classType')} htmlFor="tt-filter-type">
              <SelectField
                id="tt-filter-type"
                value={classTypeFilter}
                onChange={(e) => setClassTypeFilter(e.target.value)}
                options={[{ value: '', label: t('timetable.filters.allClassTypes') }, ...chosenStyle.classTypesOffered.map((c) => ({ value: c, label: c }))]}
              />
            </Field>
          ) : null}
        </div>
      </Card>

      {actionError ? <ErrorBanner message={actionError} /> : null}

      {!hasAnything ? (
        <Card>
          <EmptyState title={t('timetable.emptyTitle')} description={canEdit ? t('timetable.emptyDescription') : t('timetable.staffEmptyDescription')} />
        </Card>
      ) : rangeMode === 'month' ? (
        <MonthGrid
          days={days}
          weekStartsOn={weekStartsOn}
          onBook={(target) => setBooking(target)}
        />
      ) : viewMode === 'grid' ? (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto' }}>
          {days.map((day) => (
            <DayColumn key={day.date} day={day} branches={branches} onBook={setBooking} slotActions={slotActions} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {days.map((day) => (
            <DayAgendaCard key={day.date} day={day} branches={branches} onBook={setBooking} slotActions={slotActions} />
          ))}
        </div>
      )}

      {archiving ? (
        <ConfirmDeleteModal
          title={t('timetable.occurrence.archiveConfirmTitle', { title: archiving.title })}
          description={t('timetable.occurrence.archiveConfirmDescription')}
          confirmLabel={t('timetable.occurrence.archive')}
          genericErrorMessage={t('timetable.occurrence.archiveFailed')}
          onConfirm={() => archiveSlot.mutateAsync(archiving.id)}
          onClose={() => setArchiving(null)}
        />
      ) : null}

      {closuresOpen && isOwner ? <ClosuresDialog schoolId={schoolId} branches={branches} onClose={() => setClosuresOpen(false)} /> : null}

      {creating && canEdit ? (
        <TimetableSlotFormModal
          title={t('timetable.addSlotTitle')}
          wholeSchool={isOwner}
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

      {editing && canEdit ? (
        <EditSlotModal schoolId={schoolId} wholeSchool={isOwner} branches={branches} instructors={instructors} disciplines={disciplines} slot={editing} onClose={() => setEditing(null)} />
      ) : null}

      {booking ? (
        <TimetableBookingDialog
          classId={booking.classId}
          title={booking.title}
          date={booking.date}
          students={students}
          instructors={instructors}
          onClose={() => setBooking(null)}
          onBooked={() => {
            setBooking(null);
            setBookedMessage(t('timetable.booked', { title: booking.title, date: booking.date }));
            void queryClient.invalidateQueries({ queryKey: ['timetable', schoolId] });
          }}
          onWaitlisted={(position) => {
            setBooking(null);
            setBookedMessage(t('timetable.waitlisted', { title: booking.title, date: booking.date, position }));
            void queryClient.invalidateQueries({ queryKey: ['timetable', schoolId] });
          }}
        />
      ) : null}
    </>
  );
}

function branchLabel(branches: BranchResponse[], branchId: string | null | undefined, t: TranslateFn) {
  return branches.find((b) => b.id === branchId)?.name ?? (branchId ? branchId : t('timetable.wholeSchool'));
}

/** Decision 226 — shared shape for the archive/unarchive mutations every
 * occurrence-rendering component below forwards down to OccurrenceCard's
 * own RowActionsMenu, so a slot can be archived/unarchived from any
 * range mode or layout without duplicating the mutation wiring per
 * component. */
type ArchiveMutation = UseMutationResult<TimetableSlotResponse, unknown, string>;

/** The owner's slot actions; null for Branch Staff, who only book (Q4). */
type SlotActions = {
  onEdit: (slot: TimetableSlotResponse) => void;
  onArchive: (slot: TimetableSlotResponse) => void;
  unarchiveSlot: ArchiveMutation;
  setActionError: (message: string | null) => void;
  /** Decision 387 — false for a School-wide slot when the viewer isn't the owner. */
  mayChange: (slot: TimetableSlotResponse) => boolean;
};

/** One calendar entry's agenda card — shared by the Rows day-sections and the
 * Grid day columns, so "Book"/"Edit slot" behave identically regardless of
 * layout. A real Class shows its seats; a cancelled or ended one stays visible
 * without Book; an Off or archived slot still renders (dimmed) so Staff can find
 * and re-enable it (Decision 353, T7). */
function OccurrenceCard({
  entry,
  date,
  branches,
  onBook,
  slotActions,
}: {
  entry: CalendarEntry;
  date: string;
  branches: BranchResponse[];
  onBook: (target: BookingTarget) => void;
  slotActions: SlotActions | null;
}) {
  const t = useT();
  const navigate = useNavigate();
  const slot = entry.slot;
  const cls = entry.kind === 'class' ? entry.cls : null;
  const title = cls?.title ?? slot!.title;
  const cancelled = !!cls && (!!cls.cancelledAt || !!cls.archivedAt);
  const ended = !!cls && new Date(cls.endDate) <= new Date();
  const bookable = !!cls && !cancelled && !ended;
  const full = !!cls && cls.capacity !== null && cls.seatsTaken >= cls.capacity;
  const isArchived = !!slot?.archivedAt;
  const dimmed = !bookable;
  return (
    <div
      style={{
        borderLeft: `4px solid ${colorForSlot({ id: slot?.id ?? cls!.id })}`,
        borderRadius: 6,
        background: 'var(--fill-muted, #f5f5f5)',
        padding: '8px 12px',
        opacity: dimmed ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <strong style={cancelled ? { textDecoration: 'line-through' } : undefined}>{title}</strong>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {cls ? cls.startTime : slot!.startTime} – {cls ? cls.endTime : slot!.endTime} · {branchLabel(branches, cls ? cls.branchId : slot!.branchId, t)}
          </div>
          {cls ? (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {cls.capacity !== null
                ? t('timetable.occurrence.seatsOf', { taken: cls.seatsTaken, capacity: cls.capacity })
                : t('timetable.occurrence.seats', { taken: cls.seatsTaken })}
              {cls.waiting > 0 ? ` · ${t('timetable.occurrence.waiting', { count: cls.waiting })}` : ''}
            </div>
          ) : null}
        </div>
        <RowActionsMenu
          label={t('timetable.occurrence.actionsAria', { title, date })}
          actions={[
            ...(bookable ? [{ label: t('timetable.occurrence.book'), onClick: () => onBook({ classId: cls!.id, title, date }) }] : []),
            ...(cls ? [{ label: t('timetable.occurrence.openClass'), onClick: () => navigate(`/classes/${cls.id}`) }] : []),
            ...(slot && slotActions && slotActions.mayChange(slot)
              ? [
                  { label: t('timetable.occurrence.editSlot'), onClick: () => slotActions.onEdit(slot) },
                  // Decision 226 — School Owner/Manager only, idempotent, blocked
                  // (409) by an upcoming Booking against a generated Class.
                  isArchived
                    ? { label: t('timetable.occurrence.unarchive'), onClick: () => { slotActions.setActionError(null); slotActions.unarchiveSlot.mutate(slot.id, { onError: (err: unknown) => slotActions.setActionError(err instanceof ApiError ? err.message : t('timetable.occurrence.unarchiveFailed')) }); } }
                    : { label: t('timetable.occurrence.archive'), onClick: () => { slotActions.setActionError(null); slotActions.onArchive(slot); } },
                ]
              : []),
          ]}
        />
      </div>
      <div style={{ marginTop: 6 }}>
        {(cls?.activities ?? slot!.activities).map((a, i) => (
          <Badge key={`${a}-${i}`}>{a}</Badge>
        ))}
        {cancelled ? <Badge>{t('timetable.occurrence.cancelled')}</Badge> : null}
        {!cancelled && ended ? <Badge>{t('timetable.occurrence.ended')}</Badge> : null}
        {bookable && full ? <Badge>{t('timetable.occurrence.full')}</Badge> : null}
        {entry.kind === 'later' ? <Badge>{t('timetable.occurrence.later')}</Badge> : null}
        {entry.kind === 'template' && slot!.status !== 'ON' ? <Badge>{t('timetable.occurrence.off')}</Badge> : null}
        {entry.kind === 'template' && isArchived ? <Badge variant="default">{t('timetable.occurrence.archived')}</Badge> : null}
      </div>
    </div>
  );
}

/** "Closed — Christmas" on a closed date (Decision 353, Q8); a Branch closure
 * names its Branch, since the School's other Branches stay open. */
function ClosedBanner({ day, branches }: { day: DayOccurrences; branches: BranchResponse[] }) {
  const t = useT();
  if (day.closures.length === 0) return null;
  return (
    <>
      {day.closures.map((c) => (
        <p key={c.id} role="note" style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-danger, #b42318)' }}>
          {c.branchId
            ? t('timetable.closures.closedBranch', { reason: c.reason, branch: branches.find((b) => b.id === c.branchId)?.name ?? '' })
            : t('timetable.closures.closed', { reason: c.reason })}
        </p>
      ))}
    </>
  );
}

function entryKey(entry: CalendarEntry): string {
  return entry.kind === 'class' ? entry.cls.id : `${entry.kind}-${entry.slot.id}`;
}

function dayHeading(day: DayOccurrences): string {
  const label = new Date(`${day.date}T00:00:00`).toLocaleDateString(formatLocale(), { weekday: 'long', month: 'short', day: 'numeric' });
  return label;
}

function DayAgendaCard({
  day,
  branches,
  onBook,
  slotActions,
}: {
  day: DayOccurrences;
  branches: BranchResponse[];
  onBook: (target: BookingTarget) => void;
  slotActions: SlotActions | null;
}) {
  const t = useT();
  return (
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
        {dayHeading(day)}
      </h2>
      <ClosedBanner day={day} branches={branches} />
      {day.entries.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('timetable.nothingScheduled')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {day.entries.map((entry) => (
            <OccurrenceCard key={entryKey(entry)} entry={entry} date={day.date} branches={branches} onBook={onBook} slotActions={slotActions} />
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
  slotActions,
}: {
  day: DayOccurrences;
  branches: BranchResponse[];
  onBook: (target: BookingTarget) => void;
  slotActions: SlotActions | null;
}) {
  return (
    <div style={{ minWidth: 220, flex: '1 0 220px' }}>
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 14, marginBottom: 8 }}>
          {dayHeading(day)}
        </h2>
        <ClosedBanner day={day} branches={branches} />
        {day.entries.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: 13 }}>—</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {day.entries.map((entry) => (
              <OccurrenceCard key={entryKey(entry)} entry={entry} date={day.date} branches={branches} onBook={onBook} slotActions={slotActions} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** Monthly view — a real 7-column calendar grid (leading blanks so the 1st lands
 * under its real weekday), each day a dot per Class that can still be booked;
 * clicking a dot opens the same booking dialog as every other view. Cancelled,
 * ended and later dates aren't dotted (nothing to book); Day/Week show them. */
function MonthGrid({ days, weekStartsOn, onBook }: { days: DayOccurrences[]; weekStartsOn: 'MONDAY' | 'SUNDAY'; onBook: (target: BookingTarget) => void }) {
  const { t, locale } = useI18n();
  const order = weekdaysFrom(weekStartsOn);
  const leadingBlanks = order.indexOf(days[0]?.weekday ?? order[0]);
  const now = new Date();
  return (
    <Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
        {order.map((wd) => (
          <div key={wd} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' }}>
            {weekdayName(wd, locale, 'short')}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`blank-${i}`} />)}
        {days.map((day) => {
          const bookable = day.entries.flatMap((e) =>
            e.kind === 'class' && !e.cls.cancelledAt && !e.cls.archivedAt && new Date(e.cls.endDate) > now ? [e.cls] : [],
          );
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
              {day.closures.length > 0 ? (
                <span role="note" title={day.closures.map((c) => c.reason).join(', ')} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-danger, #b42318)' }}>
                  {t('timetable.closures.closedShort')}
                </span>
              ) : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {bookable.map((cls) => (
                  <button
                    key={cls.id}
                    type="button"
                    title={t('timetable.month.bookDotTitle', { title: cls.title, date: day.date })}
                    aria-label={t('timetable.month.bookDotAria', { title: cls.title, date: day.date })}
                    onClick={() => onBook({ classId: cls.id, title: cls.title, date: day.date })}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      background: colorForSlot({ id: cls.timetableSlotId ?? cls.id }),
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
  wholeSchool,
  branches,
  instructors,
  disciplines,
  slot,
  onClose,
}: {
  schoolId: string;
  wholeSchool: boolean;
  branches: BranchResponse[];
  instructors: InstructorResponse[];
  disciplines: DisciplineResponse[];
  slot: TimetableSlotResponse;
  onClose: () => void;
}) {
  const t = useT();
  const updateSlot = useUpdateTimetableSlot(schoolId, slot.id);
  // Decisions 322, 332 — set when the edit affects upcoming Classes that already
  // have bookings, or cuts capacity below seats booked; the owner chooses before
  // anything is saved.
  const [pending, setPending] = useState<{
    changes: UpdateTimetableSlotInput;
    impact: UpcomingImpactResponse;
    mode: BookedClassesMode;
    capacityCut: boolean;
  } | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);

  async function save(changes: UpdateTimetableSlotInput) {
    await updateSlot.mutateAsync(changes);
    onClose();
  }

  return (
    <>
      <TimetableSlotFormModal
        title={t('timetable.editSlotTitle')}
        wholeSchool={wholeSchool}
        initial={slot}
        branches={branches}
        instructors={instructors}
        disciplines={disciplines}
        submitting={updateSlot.isPending}
        onSubmit={async (values) => {
          // Only the changed fields, nulls included — UpdateTimetableSlotDto
          // accepts null on these fields to mean "clear it" (see
          // TimetableSlotFormValues' own header comment).
          const changes = changedSlotFields(slot, values);
          if (Object.keys(changes).length === 0) {
            onClose();
            return;
          }
          const moves = slotChangeMovesClasses(slot, changes);
          const rules = slotChangeTouchesBookingRules(changes);
          const newCapacity = changes.capacity ?? null;
          const askIfBooked = async () => {
            const impact = await fetchUpcomingImpact(slot.id);
            const capacityCut = newCapacity !== null && impact.mostTaken > newCapacity;
            const choose = (moves || rules) && impact.bookedClasses > 0;
            if (!choose && !capacityCut) return false;
            const switchingOff = changes.status === 'OFF' && slot.status === 'ON';
            const mode: BookedClassesMode = moves ? (switchingOff ? 'off' : 'move') : choose ? 'rules' : 'capacity';
            setChoiceError(null);
            setPending({ changes, impact, mode, capacityCut });
            return true;
          };
          if ((moves || rules || newCapacity !== null) && (await askIfBooked())) return;
          try {
            await save(changes);
          } catch (err) {
            // A booking made since the check above: ask now instead.
            if (err instanceof ApiError && err.status === 409 && (await askIfBooked())) return;
            throw err;
          }
        }}
        onClose={onClose}
      />
      {pending ? (
        <BookedClassesDialog
          impact={pending.impact}
          mode={pending.mode}
          capacityCut={pending.capacityCut}
          submitting={updateSlot.isPending}
          error={choiceError}
          onConfirm={async (bookedClasses) => {
            setChoiceError(null);
            try {
              await save({ ...pending.changes, bookedClasses });
            } catch (err) {
              setChoiceError(err instanceof ApiError ? err.message : t('common.tryAgain'));
            }
          }}
          onClose={() => setPending(null)}
        />
      ) : null}
    </>
  );
}
