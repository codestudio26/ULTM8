import React from 'react';
import { MenuIconSvg } from '../layout/newLookIcons';
import type { MenuIcon } from '../layout/newLookMenu';
import './dashboardPage.css';

/** A card with a light header: an icon, the title and an optional link. */
export function DashCard({
  icon,
  title,
  action,
  children,
  label,
}: {
  icon: MenuIcon;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <section className="u8n-dash__card" aria-label={label ?? title}>
      <header className="u8n-dash__card-head">
        <h2 className="u8n-dash__card-title">
          <MenuIconSvg icon={icon} />
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}
