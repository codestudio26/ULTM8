import React from 'react';
import { AppShell, Button } from '@ultm8/ui';
import { useAuth } from '../auth/AuthContext';

export function Shell({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  return (
    <AppShell
      brand="ULTM8 Platform Admin"
      navItems={[
        { label: 'Admin Users', to: '/admin-users' },
        { label: 'Schools', to: '/schools' },
        { label: 'Franchises', to: '/franchises' },
        { label: 'Impersonation', to: '/impersonation' },
        { label: 'Translations', to: '/translations' },
        { label: 'Subscription Plans', to: '/subscription-plans' },
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
