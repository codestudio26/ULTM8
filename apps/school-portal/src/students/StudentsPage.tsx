import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { Avatar } from '../lib/Avatar';
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
  const { data, isLoading, error } = useStudents(schoolId, statusFilter);

  if (!schoolId) return null;

  const students = data?.items ?? [];

  return (
    <>
      <PageHeader title="Students" subtitle="Everyone currently enrolled at your School. Open a student to see and change their ranks." />
      <Card>
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
          ) : (
            <Table<StudentSummary>
              rows={students}
              columns={[
                {
                  key: 'photo',
                  header: '',
                  render: (s) => <Avatar firstName={s.firstName} surname={s.surname} photoUrl={s.profilePhotoUrl} size={32} />,
                },
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
