import React from 'react';
import { AppShell, Button } from '@ultm8/ui';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useMyStaffPermission } from '../roleGrants/coachInviteQueries';
import { TopBar } from './TopBar';

/** A coach or Branch Staff member who doesn't own the School sees their own
 * screens (Decision 184), and "Invite coaches" when they may (Decision 183). */
const COACH_NAV = [
  { label: 'Dashboard', to: '/coach' },
  { label: 'Grading Board', to: '/grading' },
  { label: 'Notifications', to: '/notifications' },
];
const INVITE_NAV = { label: 'Invite coaches', to: '/coach-invites' };

export function Shell({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const coachSchoolId = useCoachSchoolId();
  const isCoachOnly = !useOwnedSchoolId() && !!coachSchoolId;
  const mayInvite = useMyStaffPermission(isCoachOnly ? coachSchoolId : null).data?.canInviteCoaches ?? false;
  return (
    <AppShell
      brand="ULTM8 School Portal"
      header={<TopBar />}
      navItems={isCoachOnly ? [...COACH_NAV.slice(0, 2), ...(mayInvite ? [INVITE_NAV] : []), COACH_NAV[2]] : [
        { label: 'School', to: '/school' },
        { label: 'Branches', to: '/branches' },
        { label: 'Staff', to: '/staff' },
        { label: 'Disciplines', to: '/disciplines' },
        { label: 'Instructors', to: '/instructors' },
        { label: 'Students', to: '/students' },
        { label: 'Grading Board', to: '/grading' },
        { label: 'Grading Permissions', to: '/grading-permissions' },
        { label: 'Classes', to: '/classes' },
        { label: 'Curriculum', to: '/curriculum' },
        { label: 'Timetable', to: '/timetable' },
        { label: 'Membership Plans', to: '/membership-plans' },
        { label: 'Transactions', to: '/transactions' },
        { label: 'Waivers', to: '/waivers' },
        { label: 'Franchises', to: '/franchises' },
        { label: 'Notifications', to: '/notifications' },
      ]}
      footer={
        <Button variant="secondary" fullWidth onClick={logout}>
          Log out
        </Button>
      }
    >
      {children}
    </AppShell>
  );
}
