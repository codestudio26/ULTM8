import React from 'react';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId } from '../auth/AuthContext';
import { CoachInvitesSection } from '../roleGrants/CoachInvitesSection';
import { useMyStaffPermission } from '../roleGrants/coachInviteQueries';
import { useT } from '../i18n/I18nProvider';

/** Coach invites for Branch Staff the owner has given "Can invite coaches"
 * (Decision 183): their own branches only. The owner invites from the Staff
 * page. */
export function CoachInvitesPage() {
  const t = useT();
  const schoolId = useCoachSchoolId();
  const mine = useMyStaffPermission(schoolId);
  if (!schoolId) return null;
  if (mine.isLoading) return <Spinner />;
  if (mine.error) return <ErrorBanner message={mine.error instanceof ApiError ? mine.error.message : t('coach.invites.loadFailed')} />;
  return (
    <>
      <PageHeader title={t('coach.invites.title')} subtitle={t('coach.invites.subtitle')} />
      {mine.data?.canInviteCoaches ? (
        <CoachInvitesSection schoolId={schoolId} allowedBranchIds={mine.data.branchIds} />
      ) : (
        <Card>
          <EmptyState title={t('coach.invites.cannotTitle')} description={t('coach.invites.cannotDescription')} />
        </Card>
      )}
    </>
  );
}
