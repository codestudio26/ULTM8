import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useInstructorSchoolIds, useOwnedSchoolId } from './auth/AuthContext';
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
import { CheckInPage } from './checkin/CheckInPage';
import { Shell } from './layout/Shell';

// FOUND ON REVIEW (Track B Phase 5): this previously only ever checked
// useOwnedSchoolId and fell back straight to /onboarding (CreateSchoolPage) for
// anyone without a SCHOOL_OWNER_MANAGER grant -- including an Instructor, who holds
// no such grant by design (ultm8-domain-rules §3) and would have been incorrectly
// sent to "create a School" on their very first login.
function HomeRedirect() {
  const schoolId = useOwnedSchoolId();
  const instructorSchoolIds = useInstructorSchoolIds();
  if (schoolId) return <Navigate to="/school" replace />;
  if (instructorSchoolIds.length > 0) return <Navigate to="/check-in" replace />;
  return <Navigate to="/onboarding" replace />;
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
        path="/check-in"
        element={
          <RequireAuth>
            <Shell>
              <CheckInPage />
            </Shell>
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
