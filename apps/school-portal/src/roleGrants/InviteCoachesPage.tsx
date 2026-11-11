import React from 'react';
import { Navigate } from 'react-router-dom';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { NewLookPage } from '../layout/NewLookPage';
import { TeamHeader } from '../team/TeamParts';
import { useIsMainOwner } from './roleGrantQueries';
import { CoachInvitesSection } from './CoachInvitesSection';

/**
 * Team → Invite coaches (Decision 456): the coach invites (Decision 183) that
 * sat on the Staff page, as their own tab. The same people see it as before:
 * the School's owners, where only the main owner sends and cancels (Decision
 * 423 item 10); anyone else goes to their own start page.
 */
export function InviteCoachesPage() {
  const schoolId = useOwnedSchoolId();
  const isMainOwner = useIsMainOwner(schoolId);
  if (!schoolId) return <Navigate to="/" replace />;
  return (
    <>
      <TeamHeader schoolId={schoolId} />
      <NewLookPage>
        <div className="u8t-stack">
          <CoachInvitesSection schoolId={schoolId} canManage={isMainOwner} />
        </div>
      </NewLookPage>
    </>
  );
}
