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
import { InstructorsPage } from './instructors/InstructorsPage';
import { ClassesPage } from './classes/ClassesPage';
import { TimetablePage } from './timetable/TimetablePage';
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
        path="/timetable"
        element={
          <RequireAuth>
            <Shell>
              <TimetablePage />
            </Shell>
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
