import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorBanner, Spinner, ViewToggle, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { Avatar } from '../lib/Avatar';
import { useStudents, type StudentRosterStatus, type StudentSummary } from './studentQueries';
import { StudentExportModal } from './StudentExportModal';
import { useSchool } from '../schools/schoolQueries';
import { useStudentsTabs } from './StudentsTabs';
import { useBranches } from '../branches/branchQueries';
import { matchesSearch } from './studentSearch';
import { isSymbolsOnlySearch } from '@ultm8/i18n';
import { useT } from '../i18n/I18nProvider';
import { ChildInvitesCard } from './StudentAccess';
import { formatLocale } from '../i18n/format';
import { FreezeRequestsCard } from './FreezeRequestsCard';
import { formatCalendarDay } from '../membershipPlans/freezeQueries';
import { useRosterStudents, useRosters } from './rosterQueries';
import { useSchoolTags, useTaggedStudents } from './studentTagsQueries';
import { useCustomFieldMatches, useCustomMemberFields, useCustomMemberStatuses, useCustomStatusAssignments } from './customMemberFieldsQueries';
import { MemberFieldFilter, type MemberFieldFilterValue } from './MemberFieldFilter';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import './studentsList.css';

/** The Member status filter's "no status" choice (not a status id). */
const NO_MEMBER_STATUS = '__none__';

/** Rows per page (Decision 371, Students Q2). Paged here, in the browser: the
 * roster is fetched whole, as it was before. */
export const STUDENTS_PAGE_SIZE = 25;
/** Branch filter value for students with no home branch. */
const NO_BRANCH = '__none__';

/**
 * Read-only Student roster, apart from its entry points: there is no in-line
 * create/edit here, since a Staff member doesn't create a Student profile
 * directly. A Student joins a School themselves, a Guardian enrolls a linked
 * minor, or (v1.2 backend backlog, "Invite a Student") Staff enrolls an
 * existing-but-unenrolled person they found by email/phone — all three via
 * the STUDENT RoleGrant path (SchoolsService.join()), the last one through
 * the dedicated /students/invite page linked below, not this page itself.
 * Decision 371 adds the owner's Add manually page (/students/add), for an
 * adult with no ULTM8 account yet, and search, a Branch filter and paging here.
 *
 * The new look (Decision 453; DESIGN.md → "Students list: open full page from
 * each row, panel never repeats the row"): one list card with the toolbar and
 * status chips, "Open full page ›" under each name, and the selected student
 * in the right-hand panel, which shows only what the row doesn't. On a phone,
 * tapping a row shrinks the list to it, with "Show all students (N)".
 */
export function StudentsPage() {
  const t = useT();
  const { claims } = useAuth();
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  // Decision 387 — Branch Staff whose owner turned on "students" see the
  // roster too (the API limits it to what they may see); adding and inviting
  // stay the owner's.
  const isBranchStaff = !ownedSchoolId && !!claims?.grants.some((g) => g.role === 'BRANCH_STAFF' && g.schoolId === coachSchoolId);
  // Decision 425 (Q2): coaches see the list too, read only (their role
  // always has the "students" access).
  const isCoach = !ownedSchoolId && !isBranchStaff && !!claims?.grants.some((g) => g.role === 'INSTRUCTOR' && g.schoolId === coachSchoolId);
  const isStaffHere = isBranchStaff || isCoach;
  const myAccess = useMyStaffAccess(isStaffHere ? coachSchoolId : null);
  const schoolId = ownedSchoolId ?? (myAccess.data?.access.students ? coachSchoolId : null);
  const navigate = useNavigate();
  // Active/Inactive/All filter (GET /schools/:id/students?status=) — defaults to
  // ACTIVE, the exact pre-existing behavior for this page (v1.2 backend backlog,
  // "Students page" Active/Inactive gap).
  const [statusFilter, setStatusFilter] = useState<StudentRosterStatus>('ACTIVE');
  // Rows/Grid is a pure presentation choice over the same fetched data — kept as
  // local, in-memory state (defaulting to "Rows") rather than persisted anywhere:
  // no other school-portal page persists a view/UI preference today.
  const [viewMode, setViewMode] = useState<ViewMode>('rows');
  const { data, isLoading, error } = useStudents(schoolId, statusFilter);
  const { data: branchData } = useBranches(schoolId);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  // Decision 404: only students with a membership frozen today.
  const [frozenOnly, setFrozenOnly] = useState(false);
  // Decision 317 item 6: only the students on one roster.
  const [rosterFilter, setRosterFilter] = useState('');
  const rosters = useRosters(schoolId);
  const rosterMembers = useRosterStudents(schoolId, rosterFilter || null);
  // Backlog 5.4: only students with this tag.
  const [tagFilter, setTagFilter] = useState('');
  const schoolTags = useSchoolTags(schoolId);
  const tagged = useTaggedStudents(schoolId, tagFilter || null);
  // Decision 315 item 14: the School's own member statuses, as a filter and a column.
  const [memberStatusFilter, setMemberStatusFilter] = useState('');
  const memberStatuses = useCustomMemberStatuses(schoolId);
  const memberStatusItems = memberStatuses.data?.items ?? [];
  const assignments = useCustomStatusAssignments(schoolId, memberStatusItems.length > 0);
  const memberStatusOf = useMemo(() => {
    const names = new Map((memberStatuses.data?.items ?? []).map((s) => [s.id, s.name]));
    return new Map((assignments.data?.items ?? []).map((a) => [a.studentId, { id: a.statusId, name: names.get(a.statusId) ?? '' }]));
  }, [memberStatuses.data, assignments.data]);
  // ...and its own member fields: pick a field, then a value.
  const [fieldFilter, setFieldFilter] = useState<MemberFieldFilterValue>({ fieldId: '', value: '' });
  const memberFields = useCustomMemberFields(schoolId);
  const fieldFiltering = fieldFilter.fieldId !== '' && fieldFilter.value.trim() !== '';
  const fieldMatches = useCustomFieldMatches(schoolId, fieldFilter.fieldId || null, fieldFilter.value);
  const [pageIndex, setPageIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  // The selected student, shown in the right-hand panel (the first row until
  // one is picked), and the phone's "shrink the list to that row".
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = useStudentsTabs();
  const { pathname } = useLocation();
  const school = useSchool(schoolId);
  // Decision 399: the owner, or Branch Staff the owner let export.
  const mayExport = !!ownedSchoolId || !!myAccess.data?.access.exportStudents;
  // A new filter starts again on page 1.
  useEffect(() => setPageIndex(0), [statusFilter, search, branchFilter, frozenOnly, rosterFilter, tagFilter, memberStatusFilter, fieldFilter]);

  const onRoster = useMemo(() => (rosterFilter ? new Set(rosterMembers.data?.studentIds ?? []) : null), [rosterFilter, rosterMembers.data]);
  const filtered = useMemo(
    () =>
      (data?.items ?? []).filter(
        (s) =>
          matchesSearch(s, search) &&
          (!frozenOnly || s.frozen) &&
          (!onRoster || onRoster.has(s.id)) &&
          (!tagFilter || !!tagged.data?.studentIds.includes(s.id)) &&
          (!memberStatusFilter || (memberStatusFilter === NO_MEMBER_STATUS ? !memberStatusOf.has(s.id) : memberStatusOf.get(s.id)?.id === memberStatusFilter)) &&
          (!fieldFiltering || !!fieldMatches.data?.studentIds.includes(s.id)) &&
          (!branchFilter || (branchFilter === NO_BRANCH ? !s.homeBranchId : s.homeBranchId === branchFilter)),
      ),
    [data, search, branchFilter, frozenOnly, onRoster, tagFilter, tagged.data, memberStatusFilter, memberStatusOf, fieldFiltering, fieldMatches.data],
  );

  // Only the owner, Branch Staff with the "students" switch, and coaches
  // (read only, Decision 425) have this page; anyone else typing /students
  // goes to their own home screen (Decisions 341, 387).
  if (isStaffHere && myAccess.isLoading) return <Spinner />;
  if (!schoolId) return <Navigate to="/" replace />;

  const branches = branchData?.items ?? [];
  const hasBranches = branches.length > 0;
  const pageCount = Math.max(1, Math.ceil(filtered.length / STUDENTS_PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const students = filtered.slice(page * STUDENTS_PAGE_SIZE, (page + 1) * STUDENTS_PAGE_SIZE);
  const filtering = statusFilter !== 'ACTIVE' || search.trim() !== '' || branchFilter !== '' || frozenOnly || rosterFilter !== '' || tagFilter !== '' || memberStatusFilter !== '' || fieldFiltering;
  const loading = isLoading || (!!tagFilter && tagged.isLoading) || (!!rosterFilter && rosterMembers.isLoading) || (!!memberStatusFilter && assignments.isLoading) || (fieldFiltering && fieldMatches.isLoading);
  const selected = students.find((s) => s.id === selectedId) ?? students[0] ?? null;
  // The Edit page's own gate (Decision 448 item 11): the owner, or Branch
  // Staff with "Manage students"; never for a former student.
  const mayEdit = !!ownedSchoolId || !!myAccess.data?.editStudents;
  const tagLists = (schoolTags.data?.items ?? []).length > 0;
  const nameOf = (s: StudentSummary) => `${s.firstName} ${s.surname}`.trim();
  // Decision 315 item 4: the join date staff can set (the enrolment day for a
  // row with none).
  const joinedOf = (s: StudentSummary) => (s.joinedOn ? formatCalendarDay(s.joinedOn) : new Date(s.enrolledAt).toLocaleDateString(formatLocale()));
  // A Guardian-managed child has no email of their own (Decision 341).
  const emailOf = (s: StudentSummary) => (s.guardianManaged ? t('students.managedByGuardian') : s.email);
  const pick = (s: StudentSummary) => {
    setSelectedId(s.id);
    setCollapsed(true);
  };

  const statusTags = (s: StudentSummary) => (
    <>
      <span className={'u8n-tag ' + (s.status === 'ACTIVE' ? 'u8n-tag--active' : 'u8n-tag--inactive')}>
        {s.status === 'ACTIVE' ? t('students.statusActive') : t('students.statusInactive')}
      </span>
      {/* Decision 391 */}
      {s.visitor ? <span className="u8n-tag u8n-tag--visitor">{t('students.visitor.badge')}</span> : null}
      {/* Decision 404: Frozen, with the day they are back. */}
      {s.frozen ? (
        <span className="u8n-tag u8n-tag--frozen" title={s.frozenUntil ? t('students.frozen.until', { date: formatCalendarDay(s.frozenUntil) }) : undefined}>
          {t('students.frozen.badge')}
        </span>
      ) : null}
    </>
  );
  const footer = (
    <div className="u8n-list__foot">
      <span>{t('students.list.showing', { shown: students.length, total: filtered.length })}</span>
      {filtered.length > STUDENTS_PAGE_SIZE ? (
        <span className="u8n-list__pager">
          <button type="button" className="u8n-pill" disabled={page === 0} onClick={() => setPageIndex(page - 1)}>
            {t('students.prev')}
          </button>
          <span>{t('students.pageOf', { page: page + 1, pages: pageCount })}</span>
          <button type="button" className="u8n-pill" disabled={page >= pageCount - 1} onClick={() => setPageIndex(page + 1)}>
            {t('students.next')}
          </button>
        </span>
      ) : null}
    </div>
  );

  const statusChips: Array<{ value: StudentRosterStatus; label: string }> = [
    { value: 'ACTIVE', label: t('students.statusActive') },
    { value: 'INACTIVE', label: t('students.statusInactive') },
    { value: 'ALL', label: t('students.statusAll') },
  ];

  const exportButton = mayExport ? (
    <button type="button" className="u8n-pill" onClick={() => setExporting(true)}>
      {t('students.export.button')}
    </button>
  ) : null;

  // The panel goes with the Rows view, where a row is picked; the Grid view's
  // cards open the full page, as they always have.
  const inspector = viewMode === 'rows' && selected && !loading && !error ? <SelectedStudent student={selected} hasBranches={hasBranches} mayEdit={mayEdit} joined={joinedOf(selected)} /> : undefined;

  return (
    <>
      <NewLookPageHeader
        title={t('students.title')}
        subtitle={school.data?.name}
        tabs={tabs.map((tab) => ({ to: tab.to, label: tab.count ? `${t(tab.label)} (${tab.count})` : t(tab.label), current: tab.end ? pathname === tab.to : pathname.startsWith(tab.to) }))}
        tabsLabel={t('students.tabs.aria')}
      />
      {exporting ? (
        <StudentExportModal schoolId={schoolId} schoolName={school.data?.name ?? ''} withBranch={hasBranches} onClose={() => setExporting(false)} />
      ) : null}
      <NewLookPage inspector={inspector} inspectorLabel={t('students.list.panelLabel')}>
        {/* Decision 409: the owner, or Branch Staff the owner let freeze memberships. */}
        {ownedSchoolId || myAccess.data?.access.freezeMemberships ? <FreezeRequestsCard schoolId={schoolId} /> : null}
        {/* Decision 403: children waiting for their Guardian to accept. */}
        {ownedSchoolId ? <ChildInvitesCard schoolId={ownedSchoolId} /> : null}
        <section className="u8n-list" data-collapsed={viewMode === 'rows' && collapsed && !!selected ? 'true' : 'false'} aria-label={t('students.title')}>
          <div className="u8n-list__toolbar">
            <div className="u8n-list__tools">
              <label className="u8n-list__search" htmlFor="students-search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <span className="u8n-visually-hidden">{t('students.searchLabel')}</span>
                <input id="students-search" type="search" placeholder={t('students.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <button type="button" className="u8n-pill" aria-expanded={filtersOpen} aria-controls="students-filters" onClick={() => setFiltersOpen((o) => !o)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 6h16M7 12h10M10 18h4" />
                </svg>
                {t('students.list.filter')}
              </button>
              {ownedSchoolId ? (
                <>
                  <button type="button" className="u8n-pill u8n-pill--primary" onClick={() => navigate('/students/add')}>
                    {t('students.addManuallyButton')}
                  </button>
                  <button type="button" className="u8n-pill" onClick={() => navigate('/students/invite')}>
                    {t('students.inviteButton')}
                  </button>
                </>
              ) : null}
              {exportButton ? (
                <button
                  type="button"
                  className="u8n-pill u8n-list__more"
                  aria-expanded={moreOpen}
                  aria-controls="students-more"
                  aria-label={t('students.list.moreActions')}
                  onClick={() => setMoreOpen((o) => !o)}
                >
                  <span aria-hidden="true">⋯</span>
                </button>
              ) : null}
            </div>
            <ViewToggle value={viewMode} onChange={setViewMode} aria-label={t('students.viewAria')} />
            {exportButton ? (
              <div id="students-more" className="u8n-list__extra" data-open={moreOpen ? 'true' : 'false'}>
                {exportButton}
              </div>
            ) : null}
          </div>
          {/* Decision 448 item 13: a search of only symbols finds nobody, and says why. */}
          {isSymbolsOnlySearch(search) ? <p className="u8n-list__hint">{t('students.searchSymbolsHint')}</p> : null}

          {filtersOpen ? (
            <div id="students-filters" className="u8n-list__filters">
              {hasBranches ? (
                <NewLookSelect
                  id="students-branch-filter"
                  label={t('students.branchLabel')}
                  value={branchFilter}
                  onChange={setBranchFilter}
                  options={[
                    { value: '', label: t('students.branchAll') },
                    ...branches.map((b) => ({ value: b.id, label: b.archivedAt ? `${b.name} (${t('branches.archivedBadge')})` : b.name })),
                    { value: NO_BRANCH, label: t('students.branchNone') },
                  ]}
                />
              ) : null}
              <div className="u8n-list__filter-with-link">
                <NewLookSelect
                  id="students-roster-filter"
                  label={t('students.rosters.filterLabel')}
                  value={rosterFilter}
                  onChange={setRosterFilter}
                  options={[{ value: '', label: t('students.rosters.filterAll') }, ...(rosters.data?.items ?? []).map((r) => ({ value: r.id, label: r.name }))]}
                />
                {isCoach ? null : <Link to="/students/rosters">{t('students.rosters.manage')}</Link>}
              </div>
              {tagLists ? (
                <NewLookSelect
                  id="students-tag-filter"
                  label={t('students.tags.filterLabel')}
                  value={tagFilter}
                  onChange={setTagFilter}
                  options={[{ value: '', label: t('students.tags.filterAll') }, ...(schoolTags.data?.items ?? []).map((tag) => ({ value: tag.id, label: tag.name }))]}
                />
              ) : null}
              {memberStatusItems.length > 0 ? (
                <NewLookSelect
                  id="students-member-status-filter"
                  label={t('students.customFields.filterLabel')}
                  value={memberStatusFilter}
                  onChange={setMemberStatusFilter}
                  options={[
                    { value: '', label: t('students.customFields.filterAll') },
                    ...memberStatusItems.map((s) => ({ value: s.id, label: s.name })),
                    { value: NO_MEMBER_STATUS, label: t('students.customFields.filterNone') },
                  ]}
                />
              ) : null}
              {(memberFields.data?.items ?? []).length > 0 ? <MemberFieldFilter fields={memberFields.data!.items} filter={fieldFilter} onChange={setFieldFilter} /> : null}
            </div>
          ) : null}

          <div className="u8n-list__chips">
            <div role="group" aria-label={t('students.statusLabel')} className="u8n-list__chip-group">
              {statusChips.map((c) => (
                <button key={c.value} type="button" className="u8n-chip" aria-pressed={statusFilter === c.value} onClick={() => setStatusFilter(c.value)}>
                  {c.label}
                </button>
              ))}
            </div>
            <button type="button" className="u8n-chip" aria-pressed={frozenOnly} onClick={() => setFrozenOnly((f) => !f)}>
              {t('students.frozen.filter')}
            </button>
          </div>

          {loading ? (
            <div className="u8n-list__state">
              <Spinner />
            </div>
          ) : error ? (
            <div className="u8n-list__state">
              <ErrorBanner message={error instanceof ApiError ? error.message : t('students.loadFailed')} />
            </div>
          ) : students.length === 0 ? (
            <div className="u8n-list__state">
              <EmptyState
                title={filtering ? t('students.emptyFilteredTitle') : t('students.emptyTitle')}
                description={filtering ? t('students.emptyFilteredDescription') : t('students.emptyDescription')}
              />
            </div>
          ) : viewMode === 'grid' ? (
            <>
              <ul className="u8n-grid">
                {students.map((s) => (
                  <li key={s.id} className="u8n-grid__card">
                    <div className="u8n-row__who">
                      <span className="u8n-row__avatar">
                        <Avatar firstName={s.firstName} surname={s.surname} photoUrl={s.profilePhotoUrl} size={40} color="var(--u8n-avatar-bg)" textColor="var(--u8n-avatar-text)" />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <Link to={`/students/${s.id}`} className="u8n-grid__name">
                          {nameOf(s)}
                        </Link>
                        <div className="u8n-row__tags">{statusTags(s)}</div>
                      </div>
                    </div>
                    <p>{emailOf(s)}</p>
                    {hasBranches ? <p>{s.homeBranchName ?? t('students.branchNone')}</p> : null}
                    <p>{t('students.joinedOn', { date: joinedOf(s) })}</p>
                  </li>
                ))}
              </ul>
              {footer}
            </>
          ) : (
            <>
              <div className="u8n-list__scroll">
                <table className="u8n-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('students.columnName')}</th>
                      <th scope="col">{t('students.columnEmail')}</th>
                      {memberStatusItems.length > 0 ? <th scope="col">{t('students.customFields.columnStatus')}</th> : null}
                      <th scope="col">{t('students.columnJoined')}</th>
                      <th scope="col">
                        <span className="u8n-visually-hidden">{t('students.list.panelLabel')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => {
                      const on = selected?.id === s.id;
                      const name = nameOf(s);
                      return (
                        <tr key={s.id} data-sel={on ? 'true' : 'false'} onClick={() => pick(s)}>
                          <td>
                            <div className="u8n-row__who">
                              <span className="u8n-row__avatar">
                                <Avatar firstName={s.firstName} surname={s.surname} photoUrl={s.profilePhotoUrl} size={40} color="var(--u8n-avatar-bg)" textColor="var(--u8n-avatar-text)" />
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <button type="button" className="u8n-row__name" aria-pressed={on} onClick={(e) => (e.stopPropagation(), pick(s))}>
                                  {name}
                                </button>
                                <div className="u8n-row__tags">{statusTags(s)}</div>
                                <Link to={`/students/${s.id}`} className="u8n-row__open" aria-label={t('students.list.openFullPageAria', { name })} onClick={(e) => e.stopPropagation()}>
                                  {t('students.list.openFullPage')}
                                  <span aria-hidden="true"> ›</span>
                                </Link>
                              </div>
                            </div>
                          </td>
                          <td>{emailOf(s)}</td>
                          {memberStatusItems.length > 0 ? <td>{memberStatusOf.get(s.id)?.name || '—'}</td> : null}
                          <td>{joinedOf(s)}</td>
                          <td className="u8n-row__end">
                            <button type="button" className="u8n-row__show" aria-label={t('students.list.show', { name })} aria-pressed={on} onClick={(e) => (e.stopPropagation(), pick(s))}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m9 6 6 6-6 6" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button type="button" className="u8n-list__show-all" onClick={() => setCollapsed(false)}>
                {t('students.list.showAll', { count: filtered.length })}
              </button>
              {footer}
            </>
          )}
        </section>
      </NewLookPage>
    </>
  );
}

/**
 * The right-hand panel: only what the row doesn't show (DESIGN.md →
 * "Students list: …panel never repeats the row"): the photo, name and
 * "Student since", Edit, and Training (home branch). The status tag, email
 * and "Open full page ›" are on the row, so they are left out here.
 */
function SelectedStudent({ student, hasBranches, mayEdit, joined }: { student: StudentSummary; hasBranches: boolean; mayEdit: boolean; joined: string }) {
  const t = useT();
  const name = `${student.firstName} ${student.surname}`.trim();
  const showEdit = mayEdit && student.status === 'ACTIVE';
  return (
    <div className="u8n-student-panel">
      <div className="u8n-student-panel__who">
        <Avatar firstName={student.firstName} surname={student.surname} photoUrl={student.profilePhotoUrl} size={64} color="var(--u8n-avatar-bg)" textColor="var(--u8n-avatar-text)" />
        <div style={{ minWidth: 0 }}>
          <p className="u8n-student-panel__name">{name}</p>
          <p className="u8n-student-panel__since">{t('students.list.since', { date: joined })}</p>
        </div>
      </div>
      {showEdit ? (
        <div className="u8n-student-panel__actions">
          <Link to={`/students/${student.id}/edit`} className="u8n-action-tile" aria-label={t('students.list.editAria', { name })}>
            <span className="u8n-action-tile__icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </span>
            {t('students.list.edit')}
          </Link>
        </div>
      ) : null}
      {hasBranches ? (
        <>
          <h3 className="u8n-student-panel__heading">{t('students.list.training')}</h3>
          <div className="u8n-student-panel__row">
            <span>{t('students.list.homeBranch')}</span>
            <span>{student.homeBranchName ?? t('students.branchNone')}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
