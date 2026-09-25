import React from 'react';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useStudents, type StudentSummary } from './studentQueries';

/**
 * Read-only Student roster — there is no create/edit flow here, since a Staff
 * member doesn't create a Student profile directly: a Student joins a School
 * themselves (or a Guardian enrolls a linked minor), both via the STUDENT
 * RoleGrant path (SchoolsService.join()), not this page.
 */
export function StudentsPage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useStudents(schoolId);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Students.'} />;

  const students = data?.items ?? [];

  return (
    <>
      <PageHeader title="Students" subtitle="Everyone currently enrolled at your School." />
      <Card>
        {students.length === 0 ? (
          <EmptyState
            title="No Students yet"
            description="Students appear here once they join your School (or a Guardian enrolls them)."
          />
        ) : (
          <Table<StudentSummary>
            rows={students}
            columns={[
              { key: 'name', header: 'Name', render: (s) => `${s.firstName} ${s.surname}`.trim() },
              { key: 'email', header: 'Email', render: (s) => s.email },
              { key: 'enrolledAt', header: 'Enrolled', render: (s) => new Date(s.enrolledAt).toLocaleDateString() },
            ]}
          />
        )}
      </Card>
    </>
  );
}
