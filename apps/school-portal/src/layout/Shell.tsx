import React from 'react';
import { AppShell, Button } from '@ultm8/ui';
import { useAuth, useCoachSchoolId, useIsCoachOnly } from '../auth/AuthContext';
import { useMyStaffPermission } from '../roleGrants/coachInviteQueries';
import { useSchool } from '../schools/schoolQueries';
import { TopBar } from './TopBar';
import { SchoolFooter } from './SchoolFooter';
import { VerifyBeltsNotice } from '../grading/VerifyBeltsNotice';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

/** Nav labels are translation keys, resolved at render time. */
type NavItem = { label: TranslationKey; to: string };

/** A coach or Branch Staff member who doesn't own the School sees their own
 * screens (Decision 184), and "Invite coaches" when they may (Decision 183). */
const COACH_NAV: NavItem[] = [
  { label: 'layout.nav.dashboard', to: '/coach' },
  { label: 'layout.nav.grading', to: '/grading' },
  { label: 'layout.nav.notifications', to: '/notifications' },
];
/** Read-only for coaches and Branch Staff, so they can check what each belt
 * needs (Decision 309). */
const DISCIPLINES_NAV: NavItem = { label: 'layout.nav.disciplines', to: '/disciplines' };
/** Read-only too: the lessons and their comments (Decision 326). */
const CURRICULUM_NAV: NavItem = { label: 'layout.nav.curriculum', to: '/curriculum' };
/** Read-only, to reach each Class's roll call and QR code (Classes review C4). */
const CLASSES_NAV: NavItem = { label: 'layout.nav.classes', to: '/classes' };
/** Staff at the desk check students in here (DESIGN.md → "Check-in and front-desk mode"). */
const CHECK_IN_NAV: NavItem = { label: 'layout.nav.checkIn', to: '/check-in' };
const INVITE_NAV: NavItem = { label: 'layout.nav.inviteCoaches', to: '/coach-invites' };
/** Decision 291 — Branch Staff may give credit back on cancelled bookings. */
const CANCELLATIONS_NAV: NavItem = { label: 'layout.nav.cancellations', to: '/cancellations' };
/** Instructors choose their own belt per style (Decision 188). */
const MY_BELTS_NAV: NavItem = { label: 'layout.nav.myBelts', to: '/my-belts' };
/** Branch Staff whose owner lets them take desk payments (Decision 347). */
const RECORD_PAYMENT_NAV: NavItem = { label: 'layout.nav.recordPayment', to: '/transactions' };
/** Decision 1/217/237 — self-service completion of the fields "Add
 * Manually" leaves blank; not a blocking gate, so it's an ordinary nav item,
 * not a forced redirect. */
const COMPLETE_PROFILE_NAV: NavItem = { label: 'layout.nav.completeProfile', to: '/complete-instructor-profile' };

const OWNER_NAV: NavItem[] = [
  { label: 'layout.nav.dashboard', to: '/dashboard' },
  { label: 'layout.nav.school', to: '/school' },
  { label: 'layout.nav.branches', to: '/branches' },
  { label: 'layout.nav.staff', to: '/staff' },
  { label: 'layout.nav.disciplines', to: '/disciplines' },
  { label: 'layout.nav.instructors', to: '/instructors' },
  { label: 'layout.nav.students', to: '/students' },
  // Board, Styles & Belts and Permissions are tabs inside Grading.
  { label: 'layout.nav.grading', to: '/grading' },
  { label: 'layout.nav.classes', to: '/classes' },
  { label: 'layout.nav.curriculum', to: '/curriculum' },
  { label: 'layout.nav.timetable', to: '/timetable' },
  { label: 'layout.nav.membershipPlans', to: '/membership-plans' },
  { label: 'layout.nav.transactions', to: '/transactions' },
  { label: 'layout.nav.cancellations', to: '/cancellations' },
  { label: 'layout.nav.waivers', to: '/waivers' },
  { label: 'layout.nav.franchises', to: '/franchises' },
  { label: 'layout.nav.notifications', to: '/notifications' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { logout, claims } = useAuth();
  const t = useT();
  const coachSchoolId = useCoachSchoolId();
  const isCoachOnly = useIsCoachOnly();
  const mayInvite = useMyStaffPermission(isCoachOnly ? coachSchoolId : null).data?.canInviteCoaches ?? false;
  const isInstructor = !!claims?.grants.some((g) => g.role === 'INSTRUCTOR' && g.schoolId === coachSchoolId);
  const isBranchStaff = !!claims?.grants.some((g) => g.role === 'BRANCH_STAFF' && g.schoolId === coachSchoolId);
  const mayRecordPayments = useSchool(isCoachOnly && isBranchStaff ? coachSchoolId : null).data?.branchStaffCanRecordPayments ?? false;
  return (
    <AppShell
      brand={t('layout.brand')}
      header={<TopBar />}
      navItems={(isCoachOnly
        ? [...COACH_NAV.slice(0, 2), DISCIPLINES_NAV, CURRICULUM_NAV, CLASSES_NAV, CHECK_IN_NAV, ...(isInstructor ? [MY_BELTS_NAV, COMPLETE_PROFILE_NAV] : []), ...(mayInvite ? [INVITE_NAV] : []), ...(isBranchStaff ? [CANCELLATIONS_NAV] : []), ...(mayRecordPayments ? [RECORD_PAYMENT_NAV] : []), COACH_NAV[2]]
        : OWNER_NAV
      ).map((item) => ({ ...item, label: t(item.label) }))}
      footer={
        <Button variant="secondary" fullWidth onClick={logout}>
          {t('layout.logOut')}
        </Button>
      }
      legalFooter={<SchoolFooter />}
    >
      <VerifyBeltsNotice />
      {children}
    </AppShell>
  );
}
