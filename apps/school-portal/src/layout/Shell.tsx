import React from 'react';
import { AppShell, Button } from '@ultm8/ui';
import { useAuth, useInstructorSchoolIds, useOwnedSchoolId } from '../auth/AuthContext';

export function Shell({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const ownedSchoolId = useOwnedSchoolId();
  const instructorSchoolIds = useInstructorSchoolIds();

  const navItems = [
    ...(ownedSchoolId
      ? [
          { label: 'School', to: '/school' },
          { label: 'Branches', to: '/branches' },
          { label: 'Staff', to: '/staff' },
        ]
      : []),
    // A person can hold both an owning grant and an INSTRUCTOR grant at once
    // (ultm8-domain-rules §3 — RoleGrant allows more than one role per User), so
    // these two arms are additive, not either/or.
    ...(instructorSchoolIds.length > 0 ? [{ label: 'Check-in', to: '/check-in' }] : []),
  ];

  return (
    <AppShell
      brand="ULTM8 School Portal"
      navItems={navItems}
      footer={
        <Button variant="secondary" fullWidth onClick={logout}>
          Log out
        </Button>
      }
    >
      {children}
    </AppShell>
  );
}
