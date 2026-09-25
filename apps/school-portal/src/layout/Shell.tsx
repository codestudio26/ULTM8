import React from 'react';
import { AppShell, Button } from '@ultm8/ui';
import { useAuth } from '../auth/AuthContext';
import { TopBar } from './TopBar';

export function Shell({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  return (
    <AppShell
      brand="ULTM8 School Portal"
      header={<TopBar />}
      navItems={[
        { label: 'School', to: '/school' },
        { label: 'Branches', to: '/branches' },
        { label: 'Staff', to: '/staff' },
        { label: 'Disciplines', to: '/disciplines' },
        { label: 'Instructors', to: '/instructors' },
        { label: 'Students', to: '/students' },
        { label: 'Classes', to: '/classes' },
        { label: 'Curriculum', to: '/curriculum' },
        { label: 'Timetable', to: '/timetable' },
        { label: 'Membership Plans', to: '/membership-plans' },
        { label: 'Transactions', to: '/transactions' },
        { label: 'Waivers', to: '/waivers' },
        { label: 'Franchises', to: '/franchises' },
        { label: 'Notifications', to: '/notifications' },
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
