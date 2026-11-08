import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { AcceptTermsPage } from '../legal/AcceptTermsPage';

export function RequireAuth({ children }: { children: React.ReactElement }) {
  const { accessToken, claims } = useAuth();
  const location = useLocation();

  if (!accessToken) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  // Decision 448 item 8: the Terms and Privacy tick comes before any page.
  if (claims?.legalPending) {
    return <AcceptTermsPage />;
  }
  return children;
}
