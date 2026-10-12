import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, CardGrid, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, Table, ViewToggle, type ViewMode } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useStudents, type StudentRosterStatus, type StudentSummary } from './studentQueries';

/**
 * Read-only Student roster — there is no create/edit flow here, since a Staff
 * member doesn't create a Student profile directly: a Student joins a School
 * themselves (or a Guardian enrolls a linked minor), both via the STUDENT
 * RoleGrant path (SchoolsService.join()), not this page.
 */
export function StudentsPage() {
  const schoolId = useOwnedSchoolId();
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
      <PageHeader title="Students" subtitle="Everyone currently enrolled at your School. Open a student to see and change their ranks." />
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 220 }}>
            <Field label="Status" htmlFor="students-status-filter">
              <SelectField
                id="students-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StudentRosterStatus)}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                  { value: 'ALL', label: 'All' },
                ]}
              />
            </Field>
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} aria-label="Students view" />
        </div>
      </Card>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Students.'} />
      ) : (
        <Card>
          {students.length === 0 ? (
            <EmptyState
              title={statusFilter === 'ACTIVE' ? 'No Students yet' : 'No Students match this filter'}
              description={
                statusFilter === 'ACTIVE'
                  ? 'Students appear here once they join your School (or a Guardian enrolls them).'
                  : 'Try a different status filter.'
              }
            />
          ) : viewMode === 'grid' ? (
            <CardGrid>
              {students.map((s) => (
                <Card key={s.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <Link to={`/students/${s.id}`}>{`${s.firstName} ${s.surname}`.trim()}</Link>
                    <Badge variant={s.status === 'ACTIVE' ? 'success' : 'default'}>{s.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{s.email}</p>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>Enrolled {new Date(s.enrolledAt).toLocaleDateString()}</p>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <Table<StudentSummary>
              rows={students}
              columns={[
                { key: 'name', header: 'Name', render: (s) => <Link to={`/students/${s.id}`}>{`${s.firstName} ${s.surname}`.trim()}</Link> },
                { key: 'email', header: 'Email', render: (s) => s.email },
                {
                  key: 'status',
                  header: 'Status',
                  render: (s) => <Badge variant={s.status === 'ACTIVE' ? 'success' : 'default'}>{s.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge>,
                },
                { key: 'enrolledAt', header: 'Enrolled', render: (s) => new Date(s.enrolledAt).toLocaleDateString() },
              ]}
            />
          )}
        </Card>
      )}
    </>
  );
}
