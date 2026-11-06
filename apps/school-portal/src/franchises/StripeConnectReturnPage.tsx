import React from 'react';
import { Navigate } from 'react-router-dom';
import { STRIPE_CONNECT_RETURN_KEY } from './franchiseQueries';

/**
 * Decision 407 — where Stripe's Connect onboarding sends the browser back to
 * (STRIPE_CONNECT_RETURN_URL / STRIPE_CONNECT_REFRESH_URL, `/payments/connect/
 * return` and `/refresh`). Both lead back to the page the onboarding started
 * from, remembered by the Franchise page's StripeConnectCard or the School
 * page's (Decision 441 item 6, `/school#stripe-connect`), which then reads the
 * account's status again (for a School, that read also updates the setup
 * checklist); an expired link ("refresh") is started again from there with
 * the same button. Only a portal path is ever followed, never another site.
 */
export function StripeConnectReturnPage() {
  let target = '/franchises';
  try {
    // Read, not cleared: rendering may run twice, and the next Connect overwrites it.
    const stored = sessionStorage.getItem(STRIPE_CONNECT_RETURN_KEY);
    if (stored && stored.startsWith('/') && !stored.startsWith('//')) target = stored;
  } catch {
    // No storage: the Franchises page.
  }
  return <Navigate to={target} replace />;
}
