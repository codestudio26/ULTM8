import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, ErrorBanner, RowActionsMenu, Spinner, ViewToggle, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { useSchool } from '../schools/schoolQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { classZone, formatInZone } from '../lib/datetime';
import { useBranches, type BranchResponse } from '../branches/branchQueries';
import { useInstructors, type InstructorResponse } from '../instructors/instructorQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { useArchiveClass, useClasses, useCreateClass, useUnarchiveClass, useUpdateClass, type ClassesWhen, type ClassResponse } from './classQueries';
import { ClassFormModal } from './ClassFormModal';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { ClassAvatar } from '../schedule/ClassAvatar';
import { ClassPanel } from '../schedule/ClassPanel';
import { ScheduleSelect } from '../schedule/ScheduleSelect';
import '../schedule/schedule.css';

export function ClassesPage() {
  const t = useT();
  const navigate = useNavigate();
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  // Coaches and Branch Staff get the same list to reach a Class's roll call and
  // QR code (Classes review C4), without Add/Edit/Archive: the API lets only
  // the School Owner change a Class, and Branch Staff whose owner switched on
  // "Manage classes and the timetable" their own branch's classes (Decision 387).
  const schoolId = ownedSchoolId ?? coachSchoolId;
  const { claims } = useAuth();
  const isBranchStaff = !ownedSchoolId && !!claims?.grants.some((g) => g.role === 'BRANCH_STAFF' && g.schoolId === coachSchoolId);
  const mayManage = !!useMyStaffAccess(isBranchStaff ? coachSchoolId : null).data?.access.classes;
  const readOnly = !ownedSchoolId && !mayManage;
  // A School-wide class stays the owner's.
  const mayChange = (c: ClassResponse) => !readOnly && (!!ownedSchoolId || c.branchId !== null);
  // Server-side Discipline (Activities) filter + "Search classes" box
  // (GET /schools/:schoolId/classes?activities=&search=), plus Prev/Next cursor
  // pagination (ClassListResponseDto.nextCursor was already real server-side —
  // this page just never wired a pager to it before). A cursor stack (rather than
  // ClassListResponseDto's own forward-only nextCursor) is what makes a real "Prev"
  // possible without re-fetching from page 1 or accumulating every page in memory —
  // no shared Pager component exists yet in this codebase to reuse (confirmed: no
  // other school-portal list page is paginated today), so this is a small, local,
  // one-off control, not a new shared one.
  const [activitiesFilter, setActivitiesFilter] = useState('');
  // A School with styles filters by style (Classes review C9: the free-text
  // box only matched one exact spelling of an activity).
  const [disciplineFilter, setDisciplineFilter] = useState('');
  // Classes review C3: soonest upcoming first by default, instead of every
  // Class ever made in creation order.
  const [when, setWhen] = useState<ClassesWhen>('upcoming');
  const [searchFilter, setSearchFilter] = useState('');
  // Rows/Grid is a pure presentation choice over the same fetched page of data —
  // kept as local, in-memory state (defaulting to "Rows"), not persisted: no
  // school-portal page persists a view/UI preference today (no localStorage usage
  // exists in this app), so there's no existing convention to match, and a
  // per-session default is the documented low-effort choice here.
  const [viewMode, setViewMode] = useState<ViewMode>('rows');
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursorStack[pageIndex];

  function resetPaging() {
    setCursorStack([null]);
    setPageIndex(0);
  }

  function goToNextPage(nextCursor: string | null) {
    setCursorStack((stack) => [...stack.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
  }

  // Decision 226 — archived Classes are excluded by default (server-side,
  // since this list is cursor-paginated — unlike Branches' own client-side
  // toggle, re-fetching here is the correct behavior for a paginated list).
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error } = useClasses(
    schoolId,
    {
      activities: activitiesFilter.trim() || undefined,
      disciplineId: disciplineFilter || undefined,
      search: searchFilter.trim() || undefined,
      includeArchived: showArchived,
      when,
    },
    cursor,
  );
  const { data: school } = useSchool(schoolId);
  const { data: branchData } = useBranches(schoolId);
  const { data: instructorData } = useInstructors(schoolId);
  // Archived styles too: the forms show one a record already has (Decision 310).
  const { data: disciplineData } = useDisciplines(schoolId, { includeArchived: true });
  const createClass = useCreateClass(schoolId ?? '');
  const archiveClass = useArchiveClass(schoolId ?? '');
  const unarchiveClass = useUnarchiveClass(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClassResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<ClassResponse | null>(null);
  // The class in the right-hand panel (Decision 455, Q2): the first row until
  // another is picked.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!schoolId) return null;

  const classes = data?.items ?? [];
  const branches = branchData?.items ?? [];
  const instructors = instructorData?.items ?? [];
  const disciplines = disciplineData?.items ?? [];
  const hasFilter = activitiesFilter.trim() !== '' || disciplineFilter !== '' || searchFilter.trim() !== '';
  const zoneOf = (c: ClassResponse) => classZone(branches.find((b) => b.id === c.branchId)?.timezone, school?.timezone);
  // On the Class's own clock (its Branch's zone), like the form (C12).
  const zonedTime = (iso: string, c: ClassResponse) => formatInZone(iso, zoneOf(c), formatLocale());

  function archiveActionFor(c: ClassResponse) {
    return c.archivedAt
      ? { label: t('classes.unarchive'), onClick: () => { setActionError(null); unarchiveClass.mutate(c.id, { onError: (err: unknown) => setActionError(err instanceof ApiError ? err.message : t('classes.unarchiveFailed')) }); } }
      : { label: t('classes.archive'), onClick: () => { setActionError(null); setArchiving(c); } };
  }

  function actionsFor(c: ClassResponse) {
    return [
      { label: t('classes.viewBookings'), onClick: () => navigate(`/classes/${c.id}`) },
      { label: t('classes.showQr'), onClick: () => navigate(`/classes/${c.id}/qr-code`) },
      { label: t('classes.rollCall'), onClick: () => navigate(`/classes/${c.id}/roll-call`) },
      // An archived Class can't be edited (C11): unarchive it first.
      ...(!mayChange(c) || c.archivedAt ? [] : [{ label: t('classes.edit'), onClick: () => setEditing(c) }]),
      ...(!mayChange(c) ? [] : [archiveActionFor(c)]),
    ];
  }

  function tags(c: ClassResponse) {
    return (
      <span className="u8s-tags">
        {c.activities.map((a, i) => (
          // Index-qualified key: activities are free text and may repeat.
          <span key={`${a}-${i}`} className="u8s-tag">
            {a}
          </span>
        ))}
        {c.timetableSlotId ? <span className="u8s-tag">{t('classes.fromTimetable')}</span> : null}
        {c.membershipInclusion ? <span className="u8s-tag u8s-tag--mint">{t('classes.includedInMembership')}</span> : null}
        {c.termsWaiverRequired ? <span className="u8s-tag">{t('classes.waiverRequired')}</span> : null}
      </span>
    );
  }

  // Class.instructorId is a direct FK into User (schema.prisma's own comment:
  // "NOT a separate Instructor table"), so the match is on instructor.userId.
  function instructorName(c: ClassResponse) {
    const instructor = instructors.find((i) => i.userId === c.instructorId);
    return instructor ? `${instructor.firstName} ${instructor.surname}`.trim() : null;
  }
  const branchName = (c: ClassResponse) => branches.find((b) => b.id === c.branchId)?.name ?? (c.branchId ? c.branchId : t('classes.wholeSchool'));

  function statusTags(c: ClassResponse) {
    return (
      <>
        {c.archivedAt ? <span className="u8s-tag">{t('classes.archived')}</span> : null}
        {c.cancelledAt ? <span className="u8s-tag u8s-tag--danger">{t('classes.cancelled')}</span> : null}
      </>
    );
  }

  const selected = classes.find((c) => c.id === selectedId) ?? classes[0] ?? null;

  /** Avatar → class name (coach · branch under it), DESIGN.md → "Avatars".
   * The name is the button that shows the class in the panel. */
  function classCell(c: ClassResponse) {
    return (
      <span className="u8s-class">
        <ClassAvatar title={c.title} bannerUrl={c.bannerUrl} colourKey={c.timetableSlotId ?? c.id} />
        <span className="u8s-class__text">
          <span className={'u8s-class__name' + (c.cancelledAt ? ' u8s-class__name--cancelled' : '')}>
            <button type="button" className="u8s-pick" aria-pressed={selected?.id === c.id} onClick={(e) => (e.stopPropagation(), setSelectedId(c.id))}>
              <span className="u8s-class__title">{c.title}</span>
            </button>
            {statusTags(c)}
          </span>
          <span className="u8s-class__sub">
            {[instructorName(c), branchName(c)].filter(Boolean).join(' · ')}
          </span>
        </span>
      </span>
    );
  }

  const actionsMenu = (c: ClassResponse) => <RowActionsMenu label={t('classes.actionsAria', { title: c.title })} actions={actionsFor(c)} />;
  const showPager = !isLoading && !error && (classes.length > 0 || pageIndex > 0);

  // The selected class: only what this page already loads, and the row's own
  // ⋮ actions under it (Decision 455, Q2).
  const inspector =
    !isLoading && !error && selected ? (
      <ClassPanel
        title={selected.title}
        bannerUrl={selected.bannerUrl}
        colourKey={selected.timetableSlotId ?? selected.id}
        cancelled={!!selected.cancelledAt}
        status={selected.archivedAt || selected.cancelledAt ? statusTags(selected) : null}
        facts={[
          { label: t('classes.columns.starts'), value: zonedTime(selected.startDate, selected) },
          { label: t('classes.columns.ends'), value: zonedTime(selected.endDate, selected) },
          { label: t('classes.columns.branch'), value: branchName(selected) },
          { label: t('classes.columns.instructor'), value: instructorName(selected) ?? '—' },
          { label: t('classes.columns.capacity'), value: selected.capacity ?? t('classes.unlimited') },
        ]}
        tags={tags(selected)}
        actions={actionsFor(selected)}
      />
    ) : undefined;

  return (
    <>
      <NewLookPageHeader
        title={t('classes.title')}
        subtitle={readOnly ? t('classes.subtitleReadOnly') : t('classes.subtitle')}
        actions={
          readOnly ? undefined : (
            <button type="button" className="u8s-pill u8s-pill--primary" onClick={() => setCreating(true)}>
              {t('classes.addClass')}
            </button>
          )
        }
      />
      <NewLookPage inspector={inspector} inspectorLabel={t('classes.panelLabel')}>
        <section className="u8s-card u8s-card--table">
          <div className="u8s-toolbar">
            <div className="u8s-toolbar__row">
              <label className="u8s-search">
                <span className="u8s-visually-hidden">{t('classes.searchLabel')}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  id="classes-search-filter"
                  type="search"
                  placeholder={t('classes.searchPlaceholder')}
                  value={searchFilter}
                  onChange={(e) => {
                    setSearchFilter(e.target.value);
                    resetPaging();
                  }}
                />
              </label>
              <div className="u8s-toolbar__group u8s-toolbar__group--center">
                {/* Decision 226 — archived Classes are hidden by default. */}
                <label className="u8s-check">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => {
                      setShowArchived(e.target.checked);
                      resetPaging();
                    }}
                  />
                  {t('classes.showArchived')}
                </label>
                <span className="u8s-switch">
                  <ViewToggle value={viewMode} onChange={setViewMode} aria-label={t('classes.viewAria')} />
                </span>
              </div>
            </div>
            <div className="u8s-toolbar__group">
              <ScheduleSelect
                id="classes-when-filter"
                label={t('classes.whenLabel')}
                value={when}
                onChange={(v) => {
                  setWhen(v as ClassesWhen);
                  resetPaging();
                }}
                options={[
                  { value: 'upcoming', label: t('classes.whenUpcoming') },
                  { value: 'past', label: t('classes.whenPast') },
                  { value: 'all', label: t('classes.whenAll') },
                ]}
              />
              {disciplines.length > 0 ? (
                <ScheduleSelect
                  id="classes-discipline-filter"
                  label={t('classes.disciplineFilterLabel')}
                  value={disciplineFilter}
                  onChange={(v) => {
                    setDisciplineFilter(v);
                    resetPaging();
                  }}
                  options={[{ value: '', label: t('classes.disciplineAll') }, ...disciplines.map((d) => ({ value: d.id, label: d.name }))]}
                />
              ) : (
                <div className="u8s-field">
                  <label className="u8s-field__label" htmlFor="classes-activity-filter">
                    {t('classes.disciplineFilterLabel')}
                  </label>
                  <input
                    id="classes-activity-filter"
                    aria-describedby="classes-activity-filter-hint"
                    placeholder={t('classes.disciplineFilterPlaceholder')}
                    value={activitiesFilter}
                    onChange={(e) => {
                      setActivitiesFilter(e.target.value);
                      resetPaging();
                    }}
                  />
                  <p className="u8s-field__hint" id="classes-activity-filter-hint">
                    {t('classes.disciplineFilterHint')}
                  </p>
                </div>
              )}
            </div>
          </div>

          {actionError ? (
            <div style={{ padding: '0 20px' }}>
              <ErrorBanner message={actionError} />
            </div>
          ) : null}
          {isLoading ? <Spinner /> : null}
          {error ? (
            <div style={{ padding: '0 20px 20px' }}>
              <ErrorBanner message={error instanceof ApiError ? error.message : t('classes.loadFailed')} />
            </div>
          ) : null}

          {!isLoading && !error ? (
            classes.length === 0 ? (
              <div className="u8s-empty">
                <EmptyState
                  title={hasFilter ? t('classes.emptyFilteredTitle') : t('classes.emptyTitle')}
                  description={hasFilter ? t('classes.emptyFilteredDescription') : t('classes.emptyDescription')}
                />
              </div>
            ) : viewMode === 'grid' ? (
              <div className="u8s-grid">
                {classes.map((c) => (
                  <article key={c.id} className="u8s-tile" data-sel={selected?.id === c.id ? 'true' : 'false'} onClick={() => setSelectedId(c.id)}>
                    <div className="u8s-tile__head">
                      {classCell(c)}
                      {actionsMenu(c)}
                    </div>
                    <div className="u8s-tile__facts">
                      <p>
                        {zonedTime(c.startDate, c)} – {zonedTime(c.endDate, c)}
                      </p>
                      <p>{t('classes.capacityLine', { capacity: c.capacity ?? t('classes.unlimited') })}</p>
                    </div>
                    {tags(c)}
                  </article>
                ))}
              </div>
            ) : (
                <table className="u8s-table">
                  <thead>
                    <tr>
                      <th scope="col" className="u8s-col-class">
                        {t('classes.columns.title')}
                      </th>
                      <th scope="col">{t('classes.columns.starts')}</th>
                      <th scope="col">{t('classes.columns.ends')}</th>
                      <th scope="col">{t('classes.columns.capacity')}</th>
                      <th scope="col">{t('classes.columns.activities')}</th>
                      <th scope="col" className="u8s-col-actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {classes.map((c) => (
                      <tr key={c.id} data-sel={selected?.id === c.id ? 'true' : 'false'} onClick={() => setSelectedId(c.id)}>
                        <td className="u8s-col-class">{classCell(c)}</td>
                        <td className="u8s-col-time" data-cell="starts" data-label={t('classes.columns.starts')}>
                          {zonedTime(c.startDate, c)}
                        </td>
                        <td className="u8s-col-time" data-cell="ends" data-label={t('classes.columns.ends')}>
                          {zonedTime(c.endDate, c)}
                        </td>
                        <td data-cell="capacity" data-label={t('classes.columns.capacity')}>
                          {c.capacity ?? t('classes.unlimited')}
                        </td>
                        <td data-cell="tags">{tags(c)}</td>
                        <td className="u8s-col-actions">{actionsMenu(c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            )
          ) : null}

          {showPager ? (
            <div className="u8s-foot">
              <button type="button" className="u8s-pill" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => Math.max(0, i - 1))}>
                {t('classes.prev')}
              </button>
              <button type="button" className="u8s-pill" disabled={!data?.nextCursor} onClick={() => goToNextPage(data!.nextCursor ?? null)}>
                {t('classes.next')}
              </button>
              <span>{t('classes.page', { page: pageIndex + 1 })}</span>
            </div>
          ) : null}
        </section>
      </NewLookPage>

      {archiving ? (
        <ConfirmDeleteModal
          title={t('classes.archiveConfirmTitle', { title: archiving.title })}
          description={t('classes.archiveConfirmBody')}
          confirmLabel={t('classes.archive')}
          genericErrorMessage={t('classes.archiveFailed')}
          onConfirm={() => archiveClass.mutateAsync(archiving.id)}
          onClose={() => setArchiving(null)}
        />
      ) : null}

      {creating ? (
        <ClassFormModal
          title={t('classes.addClass')}
          schoolId={schoolId}
          schoolTimezone={school?.timezone ?? null}
          currency={school?.defaultCurrency ?? null}
          schoolCurrencyMissing={!!school && !school.defaultCurrency}
          branches={branches}
          instructors={instructors}
          disciplines={disciplines}
          wholeSchool={!!ownedSchoolId}
          submitting={createClass.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's nulls back to
            // undefined (omitted), since CreateClassDto doesn't accept null.
            await createClass.mutateAsync(nullsToUndefined(values));
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditClassModal
          schoolId={schoolId}
          schoolTimezone={school?.timezone ?? null}
          currency={school?.defaultCurrency ?? null}
          schoolCurrencyMissing={!!school && !school.defaultCurrency}
          branches={branches}
          instructors={instructors}
          disciplines={disciplines}
          classItem={editing}
          wholeSchool={!!ownedSchoolId}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function EditClassModal({
  schoolId,
  schoolTimezone,
  currency,
  schoolCurrencyMissing,
  branches,
  instructors,
  disciplines,
  classItem,
  onClose,
  wholeSchool,
}: {
  schoolId: string;
  schoolTimezone: string | null;
  currency: string | null;
  schoolCurrencyMissing: boolean;
  branches: BranchResponse[];
  instructors: InstructorResponse[];
  disciplines: DisciplineResponse[];
  classItem: ClassResponse;
  onClose: () => void;
  wholeSchool: boolean;
}) {
  const t = useT();
  const updateClass = useUpdateClass(schoolId, classItem.id);
  return (
    <ClassFormModal
      title={t('classes.editClass')}
      schoolId={schoolId}
      schoolTimezone={schoolTimezone}
      currency={currency}
      schoolCurrencyMissing={schoolCurrencyMissing}
      initial={classItem}
      branches={branches}
      instructors={instructors}
      disciplines={disciplines}
      wholeSchool={wholeSchool}
      submitting={updateClass.isPending}
      onSubmit={async (values) => {
        // Passed straight through, nulls included — UpdateClassDto accepts
        // null on these fields to mean "clear it" (see ClassFormValues' own
        // header comment).
        await updateClass.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
