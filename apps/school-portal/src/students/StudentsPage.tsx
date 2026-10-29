import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardGrid, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, Table, TextField, ViewToggle, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { Avatar } from '../lib/Avatar';
import { useStudents, type StudentRosterStatus, type StudentSummary } from './studentQueries';
import { StudentsTabs } from './StudentsTabs';
import { useBranches } from '../branches/branchQueries';
import { matchesSearch } from './studentSearch';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

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
 * adult with no ULTM8 account yet, and search, a Branch column and filter,
 * and paging here.
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
  const myAccess = useMyStaffAccess(isBranchStaff ? coachSchoolId : null);
  const schoolId = ownedSchoolId ?? (myAccess.data?.access.students ? coachSchoolId : null);
  const navigate = useNavigate();
  // Active/Inactive/All filter (GET /schools/:id/students?status=) — defaults to
  // ACTIVE, the exact pre-existing behavior for this page (v1.2 backend backlog,
  // "Students page" Active/Inactive gap).
  const [statusFilter, setStatusFilter] = useState<StudentRosterStatus>('ACTIVE');
  // Rows/Grid is a pure presentation choice over the same fetched data — kept as
  // local, in-memory state (defaulting to "Rows") rather than persisted anywhere:
  // no other school-portal page persists a view/UI preference today (no
  // localStorage usage exists in this app), so there's no existing convention to
  // match, and a per-session default is the documented low-effort choice here.
  const [viewMode, setViewMode] = useState<ViewMode>('rows');
  const { data, isLoading, error } = useStudents(schoolId, statusFilter);
  const { data: branchData } = useBranches(schoolId);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  // A new filter starts again on page 1.
  useEffect(() => setPageIndex(0), [statusFilter, search, branchFilter]);

  const filtered = useMemo(
    () =>
      (data?.items ?? []).filter(
        (s) =>
          matchesSearch(s, search) &&
          (!branchFilter || (branchFilter === NO_BRANCH ? !s.homeBranchId : s.homeBranchId === branchFilter)),
      ),
    [data, search, branchFilter],
  );

  // Only the owner, and Branch Staff with the "students" switch, have this
  // page; anyone else typing /students goes to their own home screen
  // (Decisions 341, 387). Coaches reach a student from the board.
  if (isBranchStaff && myAccess.isLoading) return <Spinner />;
  if (!schoolId) return <Navigate to="/" replace />;

  const branches = branchData?.items ?? [];
  const hasBranches = branches.length > 0;
  const pageCount = Math.max(1, Math.ceil(filtered.length / STUDENTS_PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const students = filtered.slice(page * STUDENTS_PAGE_SIZE, (page + 1) * STUDENTS_PAGE_SIZE);
  const filtering = statusFilter !== 'ACTIVE' || search.trim() !== '' || branchFilter !== '';
  // A Guardian-managed child has no email of their own (Decision 341).
  const emailOf = (s: StudentSummary) => (s.guardianManaged ? t('students.managedByGuardian') : s.email);

  return (
    <>
      <PageHeader
        title={t('students.title')}
        subtitle={t('students.subtitle')}
        actions={
          ownedSchoolId ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => navigate('/students/add')}>
                {t('students.addManuallyButton')}
              </Button>
              <Button onClick={() => navigate('/students/invite')}>{t('students.inviteButton')}</Button>
            </div>
          ) : undefined
        }
      />
      <StudentsTabs />
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Field label={t('students.searchLabel')} htmlFor="students-search">
              <TextField id="students-search" type="search" placeholder={t('students.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
          </div>
          {hasBranches ? (
            <div style={{ maxWidth: 220 }}>
              <Field label={t('students.branchLabel')} htmlFor="students-branch-filter">
                <SelectField
                  id="students-branch-filter"
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  options={[
                    { value: '', label: t('students.branchAll') },
                    ...branches.map((b) => ({ value: b.id, label: b.archivedAt ? `${b.name} (${t('branches.archivedBadge')})` : b.name })),
                    { value: NO_BRANCH, label: t('students.branchNone') },
                  ]}
                />
              </Field>
            </div>
          ) : null}
          <div style={{ maxWidth: 220 }}>
            <Field label={t('students.statusLabel')} htmlFor="students-status-filter">
              <SelectField
                id="students-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StudentRosterStatus)}
                options={[
                  { value: 'ACTIVE', label: t('students.statusActive') },
                  { value: 'INACTIVE', label: t('students.statusInactive') },
                  { value: 'ALL', label: t('students.statusAll') },
                ]}
              />
            </Field>
          </div>
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} aria-label={t('students.viewAria')} />
        </div>
      </Card>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error instanceof ApiError ? error.message : t('students.loadFailed')} />
      ) : (
        <Card>
          {students.length === 0 ? (
            <EmptyState
              title={filtering ? t('students.emptyFilteredTitle') : t('students.emptyTitle')}
              description={filtering ? t('students.emptyFilteredDescription') : t('students.emptyDescription')}
            />
          ) : viewMode === 'grid' ? (
            <CardGrid>
              {students.map((s) => (
                <Card key={s.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar firstName={s.firstName} surname={s.surname} photoUrl={s.profilePhotoUrl} size={32} />
                      <Link to={`/students/${s.id}`}>{`${s.firstName} ${s.surname}`.trim()}</Link>
                    </div>
                    <Badge variant={s.status === 'ACTIVE' ? 'success' : 'default'}>{s.status === 'ACTIVE' ? t('students.statusActive') : t('students.statusInactive')}</Badge>
                    {s.visitor ? <Badge variant="info">{t('students.visitor.badge')}</Badge> : null}
                  </div>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{emailOf(s)}</p>
                  {hasBranches ? <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{s.homeBranchName ?? t('students.branchNone')}</p> : null}
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{t('students.enrolledOn', { date: new Date(s.enrolledAt).toLocaleDateString(formatLocale()) })}</p>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <Table<StudentSummary>
              rows={students}
              columns={[
                {
                  key: 'photo',
                  header: '',
                  render: (s) => <Avatar firstName={s.firstName} surname={s.surname} photoUrl={s.profilePhotoUrl} size={32} />,
                },
                { key: 'name', header: t('students.columnName'), render: (s) => <Link to={`/students/${s.id}`}>{`${s.firstName} ${s.surname}`.trim()}</Link> },
                { key: 'email', header: t('students.columnEmail'), render: (s) => emailOf(s) },
                ...(hasBranches ? [{ key: 'branch', header: t('students.columnBranch'), render: (s: StudentSummary) => s.homeBranchName ?? '—' }] : []),
                {
                  key: 'status',
                  header: t('students.columnStatus'),
                  render: (s) => (
                    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                      <Badge variant={s.status === 'ACTIVE' ? 'success' : 'default'}>{s.status === 'ACTIVE' ? t('students.statusActive') : t('students.statusInactive')}</Badge>
                      {/* Decision 391 */}
                      {s.visitor ? <Badge variant="info">{t('students.visitor.badge')}</Badge> : null}
                    </span>
                  ),
                },
                { key: 'enrolledAt', header: t('students.columnEnrolled'), render: (s) => new Date(s.enrolledAt).toLocaleDateString(formatLocale()) },
              ]}
            />
          )}
          {filtered.length > STUDENTS_PAGE_SIZE ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <Button variant="secondary" disabled={page === 0} onClick={() => setPageIndex(page - 1)}>
                {t('students.prev')}
              </Button>
              <Button variant="secondary" disabled={page >= pageCount - 1} onClick={() => setPageIndex(page + 1)}>
                {t('students.next')}
              </Button>
              <span className="ultm8-field__hint">{t('students.pageOf', { page: page + 1, pages: pageCount })}</span>
            </div>
          ) : null}
        </Card>
      )}
    </>
  );
}
