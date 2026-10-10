import React from 'react';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId } from '../auth/AuthContext';
import { CoachInvitesSection } from '../roleGrants/CoachInvitesSection';
import { useMyStaffPermission } from '../roleGrants/coachInviteQueries';

/** Coach invites for Branch Staff the owner has given "Can invite coaches"
 * (Decision 183): their own branches only. The owner invites from the Staff
 * page. */
export function CoachInvitesPage() {
  const schoolId = useCoachSchoolId();
  const mine = useMyStaffPermission(schoolId);
  if (!schoolId) return null;
  if (mine.isLoading) return <Spinner />;
  if (mine.error) return <ErrorBanner message={mine.error instanceof ApiError ? mine.error.message : 'Could not load your invite rights.'} />;
  return (
    <>
      <PageHeader title="Invite coaches" subtitle="Invite coaches to your branches." />
      {mine.data?.canInviteCoaches ? (
        <CoachInvitesSection schoolId={schoolId} allowedBranchIds={mine.data.branchIds} />
      ) : (
        <Card>
          <EmptyState title="You can't invite coaches" description="The School owner can give you this on the Staff page." />
        </Card>
      )}
    </>
  );
}
