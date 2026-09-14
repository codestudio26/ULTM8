import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './auth/LoginPage';
import { AdminUsersPage } from './adminUsers/AdminUsersPage';
import { Shell } from './layout/Shell';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Admin Users is Slice 1's only real screen (see this app's own README) —
          the default landing page once signed in, not a School/Franchise-style
          home dashboard that doesn't exist yet. */}
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

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
