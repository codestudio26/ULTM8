import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LegalFooter } from '@ultm8/ui';
import { useAuth } from '../auth/AuthContext';
import { AdminMenuIcon, type AdminMenuIconName } from './adminMenuIcons';
import './adminShell.css';

/** The menu lists the same pages, in the same order, as before the new look. */
const NAV_ITEMS: { label: string; to: string; icon: AdminMenuIconName }[] = [
  { label: 'Admin Users', to: '/admin-users', icon: 'adminUsers' },
  { label: 'Schools', to: '/schools', icon: 'schools' },
  { label: 'Franchises', to: '/franchises', icon: 'franchises' },
  { label: 'Impersonation', to: '/impersonation', icon: 'impersonation' },
  { label: 'Translations', to: '/translations', icon: 'translations' },
  { label: 'Subscription Plans', to: '/subscription-plans', icon: 'subscriptionPlans' },
  { label: 'Card Surcharge', to: '/card-surcharge', icon: 'cardSurcharge' },
  { label: "What's new", to: '/whats-new', icon: 'whatsNew' },
];

function isUnder(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * Platform Admin's app shell in the new look (Decision 453), the School
 * Portal's visual language: the 248px labelled menu with icon tiles, pinned on
 * a computer, and a sticky top bar of rounded buttons you swipe sideways on a
 * phone (DESIGN.md → "Side menu text", "Side menu stays in view", "Phone
 * layout"). Log out sits at the menu's foot, so it is in the phone's row too.
 *
 * Layout and styling only: the same pages, the same Log out, and the same
 * legal footer below the whole shell as before.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const { pathname } = useLocation();
  return (
    <div className="u8n-wrapper">
      <div className="u8n-shell">
        <nav className="u8n-nav" aria-label="Main menu" data-testid="new-look-menu">
          <div className="u8n-nav__school">
            <span className="u8n-nav__logo" aria-hidden="true">
              U8
            </span>
            <span className="u8n-nav__school-name">ULTM8 Platform Admin</span>
          </div>
          <div className="u8n-nav__items">
            {NAV_ITEMS.map((item) => {
              const active = isUnder(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={'u8n-nav__link' + (active ? ' u8n-nav__link--active' : '')}
                  aria-current={active ? 'page' : undefined}
                >
                  <Tile icon={item.icon} />
                  <span className="u8n-nav__label">{item.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="u8n-nav__spacer" />
          <div className="u8n-nav__foot">
            <button type="button" className="u8n-nav__link u8n-nav__button" onClick={logout}>
              <Tile icon="logOut" />
              <span className="u8n-nav__label">Log out</span>
            </button>
          </div>
        </nav>

        <main className="u8n-main">
          <div className="u8n-content">{children}</div>
        </main>
      </div>
      <div className="ultm8-shell__legal-footer">
        <LegalFooter />
      </div>
    </div>
  );
}

function Tile({ icon }: { icon: AdminMenuIconName }) {
  return (
    <span className="u8n-nav__tile" aria-hidden="true">
      <AdminMenuIcon icon={icon} />
    </span>
  );
}
