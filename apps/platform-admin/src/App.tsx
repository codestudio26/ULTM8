import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './auth/LoginPage';
import { AdminUsersPage } from './adminUsers/AdminUsersPage';
import { SchoolLookupPage } from './schools/SchoolLookupPage';
import { FranchiseLookupPage } from './franchises/FranchiseLookupPage';
import { ImpersonationPage } from './impersonation/ImpersonationPage';
import { TranslationsPage } from './translations/TranslationsPage';
import { Shell } from './layout/Shell';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Admin Users is still the default landing page (see this app's own
          README) — not a home dashboard, which doesn't exist yet. */}
      <Route path="/" element={<Navigate to="/admin-users" replace />} />
      <Route
        path="/admin-users"
        element={
          <RequireAuth>
            <Shell>
              <AdminUsersPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/schools"
        element={
          <RequireAuth>
            <Shell>
              <SchoolLookupPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/franchises"
        element={
          <RequireAuth>
            <Shell>
              <FranchiseLookupPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/impersonation"
        element={
          <RequireAuth>
            <Shell>
              <ImpersonationPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/translations"
        element={
          <RequireAuth>
            <Shell>
              <TranslationsPage />
            </Shell>
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
