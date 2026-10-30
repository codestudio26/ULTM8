import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardGrid, Checkbox, EmptyState, ErrorBanner, Field, PageHeader, RowActionsMenu, SelectField, Spinner, Table, TextField, ViewToggle, type ViewMode } from '@ultm8/ui';
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

  function badges(c: ClassResponse) {
    return (
      <>
        {c.activities.map((a, i) => (
          <Badge key={`${a}-${i}`}>{a}</Badge>
        ))}
        {c.timetableSlotId ? <Badge variant="default">{t('classes.fromTimetable')}</Badge> : null}
        {c.membershipInclusion ? <Badge variant="accent">{t('classes.includedInMembership')}</Badge> : null}
        {c.termsWaiverRequired ? <Badge>{t('classes.waiverRequired')}</Badge> : null}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('classes.title')}
        subtitle={readOnly ? t('classes.subtitleReadOnly') : t('classes.subtitle')}
        actions={readOnly ? undefined : <Button onClick={() => setCreating(true)}>{t('classes.addClass')}</Button>}
      />
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 160 }}>
              <Field label={t('classes.whenLabel')} htmlFor="classes-when-filter">
                <SelectField
                  id="classes-when-filter"
                  value={when}
                  onChange={(e) => {
                    setWhen(e.target.value as ClassesWhen);
                    resetPaging();
                  }}
                  options={[
                    { value: 'upcoming', label: t('classes.whenUpcoming') },
                    { value: 'past', label: t('classes.whenPast') },
                    { value: 'all', label: t('classes.whenAll') },
                  ]}
                />
              </Field>
            </div>
            {disciplines.length > 0 ? (
            <div style={{ minWidth: 200 }}>
              <Field label={t('classes.disciplineFilterLabel')} htmlFor="classes-discipline-filter">
                <SelectField
                  id="classes-discipline-filter"
                  value={disciplineFilter}
                  onChange={(e) => {
                    setDisciplineFilter(e.target.value);
                    resetPaging();
                  }}
                  options={[{ value: '', label: t('classes.disciplineAll') }, ...disciplines.map((d) => ({ value: d.id, label: d.name }))]}
                />
              </Field>
            </div>
            ) : (
            <div style={{ minWidth: 200 }}>
              <Field label={t('classes.disciplineFilterLabel')} htmlFor="classes-activity-filter" hint={t('classes.disciplineFilterHint')}>
                <TextField
                  id="classes-activity-filter"
                  placeholder={t('classes.disciplineFilterPlaceholder')}
                  value={activitiesFilter}
                  onChange={(e) => {
                    setActivitiesFilter(e.target.value);
                    resetPaging();
                  }}
                />
              </Field>
            </div>
            )}
            <div style={{ minWidth: 200 }}>
              <Field label={t('classes.searchLabel')} htmlFor="classes-search-filter">
                <TextField
                  id="classes-search-filter"
                  type="search"
                  placeholder={t('classes.searchPlaceholder')}
                  value={searchFilter}
                  onChange={(e) => {
                    setSearchFilter(e.target.value);
                    resetPaging();
                  }}
                />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {/* Decision 226 — archived Classes are hidden by default. */}
            <Checkbox label={t('classes.showArchived')} checked={showArchived} onChange={(e) => { setShowArchived(e.target.checked); resetPaging(); }} />
            <ViewToggle value={viewMode} onChange={setViewMode} aria-label={t('classes.viewAria')} />
          </div>
        </div>
      </Card>
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {isLoading ? <Spinner /> : null}
      {error ? <ErrorBanner message={error instanceof ApiError ? error.message : t('classes.loadFailed')} /> : null}
      {!isLoading && !error ? (
      <Card>
        {classes.length === 0 ? (
          <EmptyState
            title={hasFilter ? t('classes.emptyFilteredTitle') : t('classes.emptyTitle')}
            description={hasFilter ? t('classes.emptyFilteredDescription') : t('classes.emptyDescription')}
          />
        ) : viewMode === 'grid' ? (
          <CardGrid>
            {classes.map((c) => {
              // Class.instructorId is a direct FK into User (schema.prisma's own
              // comment: "NOT a separate Instructor table"), so the match is on
              // instructor.userId, not instructor.id — same lookup the Rows
              // table's own "Instructor" column uses.
              const instructor = instructors.find((i) => i.userId === c.instructorId);
              const branchName = branches.find((b) => b.id === c.branchId)?.name ?? (c.branchId ? c.branchId : t('classes.wholeSchool'));
              return (
                <Card key={c.id}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <ClassThumbnail bannerUrl={c.bannerUrl} title={c.title} size={40} />
                    <strong>{c.title}</strong>
                    {c.archivedAt ? <Badge variant="default">{t('classes.archived')}</Badge> : null}
                    {c.cancelledAt ? <Badge variant="danger">{t('classes.cancelled')}</Badge> : null}
                  </div>
                  <div style={{ margin: '8px 0' }}>{badges(c)}</div>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                    {instructor ? `${instructor.firstName} ${instructor.surname}`.trim() : '—'}
                  </p>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                    {zonedTime(c.startDate, c)} – {zonedTime(c.endDate, c)}
                  </p>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{t('classes.capacityLine', { capacity: c.capacity ?? t('classes.unlimited') })}</p>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{branchName}</p>
                  <div style={{ marginTop: 12 }}>
                    <RowActionsMenu
                      label={t('classes.actionsAria', { title: c.title })}
                      actions={actionsFor(c)}
                    />
                  </div>
                </Card>
              );
            })}
          </CardGrid>
        ) : (
          <Table<ClassResponse>
            rows={classes}
            columns={[
              { key: 'banner', header: '', render: (c) => <ClassThumbnail bannerUrl={c.bannerUrl} title={c.title} size={32} /> },
              { key: 'title', header: t('classes.columns.title'), render: (c) => (<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{c.title}{c.archivedAt ? <Badge variant="default">{t('classes.archived')}</Badge> : null}{c.cancelledAt ? <Badge variant="danger">{t('classes.cancelled')}</Badge> : null}</div>) },
              {
                key: 'activities',
                header: t('classes.columns.activities'),
                // Index-qualified key — activities is unconstrained free text
                // (no dedup enforced), so two identical entries would
                // otherwise collide on the same key.
                render: (c) => badges(c),
              },
              {
                key: 'instructor',
                header: t('classes.columns.instructor'),
                render: (c) => {
                  // Class.instructorId is a direct FK into User (schema.prisma's own
                  // comment: "NOT a separate Instructor table"), so the match is on
                  // instructor.userId, not instructor.id.
                  const instructor = instructors.find((i) => i.userId === c.instructorId);
                  return instructor ? `${instructor.firstName} ${instructor.surname}`.trim() : '—';
                },
              },
              { key: 'start', header: t('classes.columns.starts'), render: (c) => zonedTime(c.startDate, c) },
              { key: 'end', header: t('classes.columns.ends'), render: (c) => zonedTime(c.endDate, c) },
              { key: 'capacity', header: t('classes.columns.capacity'), render: (c) => c.capacity ?? t('classes.unlimited') },
              {
                key: 'branch',
                header: t('classes.columns.branch'),
                render: (c) => branches.find((b) => b.id === c.branchId)?.name ?? (c.branchId ? c.branchId : t('classes.wholeSchool')),
              },
              {
                key: 'actions',
                header: '',
                render: (c) => (
                  <RowActionsMenu
                    label={t('classes.actionsAria', { title: c.title })}
                    actions={actionsFor(c)}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>
      ) : null}

      {!isLoading && !error && (classes.length > 0 || pageIndex > 0) ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <Button variant="secondary" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => Math.max(0, i - 1))}>
            {t('classes.prev')}
          </Button>
          <Button variant="secondary" disabled={!data?.nextCursor} onClick={() => goToNextPage(data!.nextCursor ?? null)}>
            {t('classes.next')}
          </Button>
          <span className="ultm8-field__hint">{t('classes.page', { page: pageIndex + 1 })}</span>
        </div>
      ) : null}

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

/**
 * Minimal one-off thumbnail for `Class.bannerUrl` — a read-only roster-row
 * display, not a form field (the form's own Banner field is a
 * `PhotoUploadField` as of the real-photo-uploads phase — see
 * `ClassFormModal.tsx`), so a plain `<img>` is all this needs regardless of
 * whether `bannerUrl` came from an upload or (for a Class banner saved before
 * this phase) a pasted URL — both are just a URL by the time this renders.
 * Doesn't reuse the shared `Avatar` component (`../lib/Avatar.tsx`): Avatar's
 * placeholder is a firstName/surname initials monogram, and a Class has
 * neither — a plain "no banner" placeholder square (the title's first
 * letter) fits better than forcing a two-letter-initials shape onto a Class
 * title.
 */
function ClassThumbnail({ bannerUrl, title, size }: { bannerUrl: string | null | undefined; title: string; size: number }) {
  if (bannerUrl) {
    return (
      <img
        src={bannerUrl}
        alt=""
        style={{ width: size, height: size, borderRadius: 6, objectFit: 'cover', flex: 'none' }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 6,
        background: 'var(--fill-accent)',
        color: '#ffffff',
        fontSize: Math.round(size * 0.4),
        fontWeight: 500,
        flex: 'none',
      }}
    >
      {title[0]?.toUpperCase() ?? '?'}
    </span>
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
