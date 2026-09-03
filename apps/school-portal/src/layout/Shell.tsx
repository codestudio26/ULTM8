import React from 'react';
import { AppShell, Button } from '@ultm8/ui';
import { useAuth } from '../auth/AuthContext';

export function Shell({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  return (
    <AppShell
      brand="ULTM8 School Portal"
      navItems={[
        { label: 'School', to: '/school' },
        { label: 'Branches', to: '/branches' },
        { label: 'Staff', to: '/staff' },
      ]}
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
