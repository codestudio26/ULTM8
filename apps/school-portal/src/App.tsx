import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useOwnedSchoolId } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { VerifyOtpPage } from './auth/VerifyOtpPage';
import { ForgotPasscodePage } from './auth/ForgotPasscodePage';
import { ResetPasscodePage } from './auth/ResetPasscodePage';
import { CreateSchoolPage } from './schools/CreateSchoolPage';
import { SchoolPage } from './schools/SchoolPage';
import { BranchesPage } from './branches/BranchesPage';
import { StaffPage } from './roleGrants/StaffPage';
import { DisciplinesPage } from './disciplines/DisciplinesPage';
import { DisciplineDetailPage } from './disciplines/DisciplineDetailPage';
import { InstructorsPage } from './instructors/InstructorsPage';
import { ClassesPage } from './classes/ClassesPage';
import { ClassDetailPage } from './classes/ClassDetailPage';
import { TimetablePage } from './timetable/TimetablePage';
import { MembershipPlansPage } from './membershipPlans/MembershipPlansPage';
import { TransactionsPage } from './transactions/TransactionsPage';
import { WaiversPage } from './waivers/WaiversPage';
import { FranchisesPage } from './franchises/FranchisesPage';
import { FranchiseDetailPage } from './franchises/FranchiseDetailPage';
import { NotificationsPage } from './notifications/NotificationsPage';
import { Shell } from './layout/Shell';

function HomeRedirect() {
  const schoolId = useOwnedSchoolId();
  return <Navigate to={schoolId ? '/school' : '/onboarding'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-otp" element={<VerifyOtpPage />} />
      <Route path="/forgot-passcode" element={<ForgotPasscodePage />} />
      <Route path="/reset-passcode" element={<ResetPasscodePage />} />

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
        path="/school"
        element={
          <RequireAuth>
            <Shell>
              <SchoolPage />
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

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
