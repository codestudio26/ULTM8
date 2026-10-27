import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from './auth/AuthContext';
import { CoachDashboardPage } from './coach/CoachDashboardPage';
import { CoachInvitesPage } from './coach/CoachInvitesPage';
import { MyBeltsPage } from './coach/MyBeltsPage';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { VerifyOtpPage } from './auth/VerifyOtpPage';
import { ForgotPasscodePage } from './auth/ForgotPasscodePage';
import { ResetPasscodePage } from './auth/ResetPasscodePage';
import { FirstLoginPasscodeChangePage } from './auth/FirstLoginPasscodeChangePage';
import { CoachInvitePage } from './auth/CoachInvitePage';
import { CreateSchoolPage } from './schools/CreateSchoolPage';
import { SchoolPage } from './schools/SchoolPage';
import { MyProfilePage } from './profile/MyProfilePage';
import { DashboardPage } from './dashboard/DashboardPage';
import { BookingsDrilldownPage } from './dashboard/BookingsDrilldownPage';
import { BranchesPage } from './branches/BranchesPage';
import { BranchSettingsPage } from './branches/BranchSettingsPage';
import { StaffPage } from './roleGrants/StaffPage';
import { DisciplinesPage } from './disciplines/DisciplinesPage';
import { DisciplineDetailPage } from './disciplines/DisciplineDetailPage';
import { InstructorsPage } from './instructors/InstructorsPage';
import { InstructorDetailPage } from './instructors/InstructorDetailPage';
import { CompleteInstructorProfilePage } from './instructors/CompleteInstructorProfilePage';
import { StudentsPage } from './students/StudentsPage';
import { CheckInPage } from './frontdesk/CheckInPage';
import { FrontDeskModePage } from './frontdesk/FrontDeskModePage';
import { InviteStudentPage } from './students/InviteStudentPage';
import { StudentUpdatePage } from './students/StudentUpdatePage';
import { StudentGradingPage } from './grading/StudentGradingPage';
import { GradingBoardPage } from './grading/GradingBoardPage';
import { GradingPermissionsPage } from './grading/GradingPermissionsPage';
import { GradingSettingsPage } from './grading/GradingSettingsPage';
import { GradingSkillsPage } from './grading/GradingSkillsPage';
import { ClassesPage } from './classes/ClassesPage';
import { ClassDetailPage } from './classes/ClassDetailPage';
import { ClassQrCodePage } from './attendance/ClassQrCodePage';
import { RollCallPage } from './attendance/RollCallPage';
import { CurriculumPage } from './curriculum/CurriculumPage';
import { TimetablePage } from './timetable/TimetablePage';
import { MembershipPlansPage } from './membershipPlans/MembershipPlansPage';
import { MembershipPlanFormPage } from './membershipPlans/MembershipPlanFormPage';
import { CancellationsPage } from './cancellations/CancellationsPage';
import { MembershipPlanMembersPage } from './membershipPlans/MembershipPlanMembersPage';
import { TransactionsPage } from './transactions/TransactionsPage';
import { WaiversPage } from './waivers/WaiversPage';
import { WaiverSettingsPage } from './waivers/WaiverSettingsPage';
import { FranchisesPage } from './franchises/FranchisesPage';
import { FranchiseDetailPage } from './franchises/FranchiseDetailPage';
import { NotificationsPage } from './notifications/NotificationsPage';
import { Shell } from './layout/Shell';

/** Owners land on the Dashboard (Bookings This Week + KPIs); coaches on their own
 * dashboard (Decision 184, a different page — `/coach`); a Franchise owner who owns
 * no School on Franchises (sign-in review A13); anyone else on creating a School.
 * The School profile itself (`/school`) is still reachable from the nav, just no
 * longer the landing page. */
function HomeRedirect() {
  const schoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  const ownsFranchise = !!useAuth().claims?.grants.some((g) => g.role === 'FRANCHISE_OWNER');
  return <Navigate to={schoolId ? '/dashboard' : coachSchoolId ? '/coach' : ownsFranchise ? '/franchises' : '/onboarding'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-otp" element={<VerifyOtpPage />} />
      <Route path="/forgot-passcode" element={<ForgotPasscodePage />} />
      <Route path="/reset-passcode" element={<ResetPasscodePage />} />
      <Route path="/first-login-passcode-change" element={<FirstLoginPasscodeChangePage />} />
      <Route path="/coach-invite/:token" element={<CoachInvitePage />} />

      <Route path="/" element={<RequireAuth><HomeRedirect /></RequireAuth>} />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <CreateSchoolPage />
          </RequireAuth>
        }
      />
      <Route
        path="/coach"
        element={
          <RequireAuth>
            <Shell>
              <CoachDashboardPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/my-belts"
        element={
          <RequireAuth>
            <Shell>
              <MyBeltsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/coach-invites"
        element={
          <RequireAuth>
            <Shell>
              <CoachInvitesPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/complete-instructor-profile"
        element={
          <RequireAuth>
            <Shell>
              <CompleteInstructorProfilePage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/school"
        element={
          <RequireAuth>
            <Shell>
              <SchoolPage />
            </Shell>
          </RequireAuth>
        }
      />
      {/* The signed-in user's own profile — any portal user, from the header's account menu. */}
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <Shell>
              <MyProfilePage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Shell>
              <DashboardPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/bookings-drilldown"
        element={
          <RequireAuth>
            <Shell>
              <BookingsDrilldownPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/branches"
        element={
          <RequireAuth>
            <Shell>
              <BranchesPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/branches/:id"
        element={
          <RequireAuth>
            <Shell>
              <BranchSettingsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/staff"
        element={
          <RequireAuth>
            <Shell>
              <StaffPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/disciplines"
        element={
          <RequireAuth>
            <Shell>
              <DisciplinesPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/disciplines/:id"
        element={
          <RequireAuth>
            <Shell>
              <DisciplineDetailPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/instructors"
        element={
          <RequireAuth>
            <Shell>
              <InstructorsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/instructors/:id"
        element={
          <RequireAuth>
            <Shell>
              <InstructorDetailPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/students"
        element={
          <RequireAuth>
            <Shell>
              <StudentsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/check-in"
        element={
          <RequireAuth>
            <Shell>
              <CheckInPage />
            </Shell>
          </RequireAuth>
        }
      />
      {/* Front-desk mode is full screen: no menu (DESIGN.md → "Check-in and front-desk mode"). */}
      <Route
        path="/front-desk"
        element={
          <RequireAuth>
            <FrontDeskModePage />
          </RequireAuth>
        }
      />
      <Route
        path="/students/invite"
        element={
          <RequireAuth>
            <Shell>
              <InviteStudentPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/students/:id"
        element={
          <RequireAuth>
            <Shell>
              <StudentGradingPage />
            </Shell>
          </RequireAuth>
        }
      />
      {/* `StudentUpdate.dc.html` (v1.2 backend backlog) — a dedicated page, not
        * a Modal over StudentGradingPage; see StudentUpdatePage.tsx's own
        * header comment for why. */}
      <Route
        path="/students/:id/edit"
        element={
          <RequireAuth>
            <Shell>
              <StudentUpdatePage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/grading"
        element={
          <RequireAuth>
            <Shell>
              <GradingBoardPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/grading/permissions"
        element={
          <RequireAuth>
            <Shell>
              <GradingPermissionsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/grading/settings"
        element={
          <RequireAuth>
            <Shell>
              <GradingSettingsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/grading/skills"
        element={
          <RequireAuth>
            <Shell>
              <GradingSkillsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/classes"
        element={
          <RequireAuth>
            <Shell>
              <ClassesPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/classes/:id"
        element={
          <RequireAuth>
            <Shell>
              <ClassDetailPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/classes/:id/qr-code"
        element={
          <RequireAuth>
            <Shell>
              <ClassQrCodePage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/classes/:id/roll-call"
        element={
          <RequireAuth>
            <Shell>
              <RollCallPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/curriculum"
        element={
          <RequireAuth>
            <Shell>
              <CurriculumPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/timetable"
        element={
          <RequireAuth>
            <Shell>
              <TimetablePage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/membership-plans"
        element={
          <RequireAuth>
            <Shell>
              <MembershipPlansPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/membership-plans/new"
        element={
          <RequireAuth>
            <Shell>
              <MembershipPlanFormPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/membership-plans/:id/members"
        element={
          <RequireAuth>
            <Shell>
              <MembershipPlanMembersPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/membership-plans/:id/edit"
        element={
          <RequireAuth>
            <Shell>
              <MembershipPlanFormPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/transactions"
        element={
          <RequireAuth>
            <Shell>
              <TransactionsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/cancellations"
        element={
          <RequireAuth>
            <Shell>
              <CancellationsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/waivers"
        element={
          <RequireAuth>
            <Shell>
              <WaiversPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/waivers/settings"
        element={
          <RequireAuth>
            <Shell>
              <WaiverSettingsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/franchises"
        element={
          <RequireAuth>
            <Shell>
              <FranchisesPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/franchises/:id"
        element={
          <RequireAuth>
            <Shell>
              <FranchiseDetailPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/notifications"
        element={
          <RequireAuth>
            <Shell>
              <NotificationsPage />
            </Shell>
          </RequireAuth>
        }
      />

      {/* The Permissions page moved under Grading's tabs. */}
      <Route path="/grading-permissions" element={<Navigate to="/grading/permissions" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
