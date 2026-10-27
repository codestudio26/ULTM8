import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardGrid, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, Table, ViewToggle, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { Avatar } from '../lib/Avatar';
import { useStudents, type StudentRosterStatus, type StudentSummary } from './studentQueries';
import { StudentsTabs } from './StudentsTabs';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

/**
 * Read-only Student roster, apart from one entry point: there is no in-line
 * create/edit here, since a Staff member doesn't create a Student profile
 * directly. A Student joins a School themselves, a Guardian enrolls a linked
 * minor, or (v1.2 backend backlog, "Invite a Student") Staff enrolls an
 * existing-but-unenrolled person they found by email/phone — all three via
 * the STUDENT RoleGrant path (SchoolsService.join()), the last one through
 * the dedicated /students/invite page linked below, not this page itself.
 */
export function StudentsPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
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

  if (!schoolId) return null;

  const students = data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('students.title')}
        subtitle={t('students.subtitle')}
        actions={<Button onClick={() => navigate('/students/invite')}>{t('students.inviteButton')}</Button>}
      />
      <StudentsTabs />
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
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
              title={statusFilter === 'ACTIVE' ? t('students.emptyTitle') : t('students.emptyFilteredTitle')}
              description={statusFilter === 'ACTIVE' ? t('students.emptyDescription') : t('students.emptyFilteredDescription')}
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
                  </div>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{s.email}</p>
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
                { key: 'email', header: t('students.columnEmail'), render: (s) => s.email },
                {
                  key: 'status',
                  header: t('students.columnStatus'),
                  render: (s) => <Badge variant={s.status === 'ACTIVE' ? 'success' : 'default'}>{s.status === 'ACTIVE' ? t('students.statusActive') : t('students.statusInactive')}</Badge>,
                },
                { key: 'enrolledAt', header: t('students.columnEnrolled'), render: (s) => new Date(s.enrolledAt).toLocaleDateString(formatLocale()) },
              ]}
            />
          )}
        </Card>
      )}
    </>
  );
}
