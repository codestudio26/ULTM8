import React from 'react';

export type AdminMenuIconName =
  | 'adminUsers'
  | 'schools'
  | 'franchises'
  | 'impersonation'
  | 'translations'
  | 'subscriptionPlans'
  | 'cardSurcharge'
  | 'whatsNew'
  | 'logOut';

/** The side menu's outline icons (18px, 1.8 stroke), in the same style as the
 * School Portal's (apps/school-portal/src/layout/newLookIcons.tsx).
 * Decorative: each sits beside its text label. */
export function AdminMenuIcon({ icon }: { icon: AdminMenuIconName }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[icon]}
    </svg>
  );
}

const PATHS: Record<AdminMenuIconName, React.ReactNode> = {
  adminUsers: (
    <>
      <path d="M12 2.5 4 5.5v6c0 4.6 3.4 8.4 8 10 4.6-1.6 8-5.4 8-10v-6z" />
      <circle cx="12" cy="10" r="2.5" />
      <path d="M8 16c.8-1.9 2.2-2.8 4-2.8s3.2.9 4 2.8" />
    </>
  ),
  // The same building as the School Portal's "Organisation".
  schools: <path d="M4 21V5l8-3v19M12 9h8v12M4 21h17M7.5 8h1M7.5 12h1M7.5 16h1M15.5 13h1M15.5 17h1" />,
  franchises: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-4h12v4" />
    </>
  ),
  impersonation: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.6 0 3 .5 4.1 1.4" />
      <path d="M15 17h6M18.5 14.5 21 17l-2.5 2.5" />
    </>
  ),
  translations: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3" />
    </>
  ),
  subscriptionPlans: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  // The same card as the School Portal's "Billing".
  cardSurcharge: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19M6.5 15h4" />
    </>
  ),
  whatsNew: (
    <>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <path d="M12 8.5 13.2 11l2.3 1-2.3 1L12 15.5 10.8 13l-2.3-1 2.3-1z" />
    </>
  ),
  logOut: (
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16l-4-4 4-4M6 12h10" />
    </>
  ),
};
