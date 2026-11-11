import React, { useMemo } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { firstGrapheme } from '@ultm8/i18n';
import { useAuth, useCoachSchoolId, useGradingSchoolId, useIsCoachOnly, useOwnedSchoolId } from '../auth/AuthContext';
import { useCurrentUser } from '../auth/currentUserQueries';
import { useNotificationCounts } from '../notifications/notificationQueries';
import { useSchool } from '../schools/schoolQueries';
import { SchoolSwitcher } from '../coach/SchoolSwitcher';
import { VerifyBeltsNotice } from '../grading/VerifyBeltsNotice';
import { useT } from '../i18n/I18nProvider';
import { AccountMenu } from './AccountMenu';
import { GlobalSearch } from './GlobalSearch';
import { SchoolFooter } from './SchoolFooter';
import { TrialBanner } from './TrialBanner';
import { LanguagePicker, NotificationsBell, WhatsNewLink } from './TopBar';
import { roleLabel } from './roleLabel';
import { activeEntry, activePage, buildMenu, isUnder, type MenuEntry, type MenuIcon } from './newLookMenu';
import { MenuIconSvg } from './newLookIcons';
import './newLookShell.css';

/**
 * The new look's app shell (DESIGN-BRIEF §8, design D; DESIGN.md → "Side menu
 * text", "Side menu stays in view", "Phone layout"). Shown only while "Try the
 * new look" is on (Shell.tsx); the classic shell is untouched.
 *
 * - Left: the 248px labelled menu. The School, the search, then the groups
 *   (newLookMenu.ts) this person has pages in, Settings and the signed-in
 *   person at the foot. It stays in view on a computer.
 * - Top of the page: the group's other pages as tabs, and the header tools
 *   (What's new, the bell, the School switcher, language).
 * - On a phone the menu becomes a sticky top bar with the sections as a row of
 *   rounded buttons you swipe sideways; the search and the account move into
 *   the tools row, so nothing on the computer is missing on a phone.
 *
 * Layout and styling only: the menu lists exactly the pages the classic one
 * does (`navItems` from `useShellNavItems`), and pages render as they are.
 */
export function NewLookShell({ navItems, children }: { navItems: { label: string; to: string }[]; children: React.ReactNode }) {
  const t = useT();
  const { pathname } = useLocation();
  const { claims } = useAuth();
  const isCoachOnly = useIsCoachOnly();
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  const schoolId = useGradingSchoolId();
  const school = useSchool(schoolId).data;
  const { data: me } = useCurrentUser();
  const { data: counts } = useNotificationCounts();
  const hasUnread = (counts?.unread ?? 0) > 0;

  const menu = useMemo(() => buildMenu(navItems), [navItems]);
  const current = activeEntry(menu, pathname);
  const currentPage = current ? activePage(current, pathname) : null;

  const groupLabel = (entry: MenuEntry): string => {
    switch (entry.group) {
      case 'dashboard':
        return t('layout.nav.dashboard');
      case 'students':
        return t('layout.nav.students');
      case 'team':
        return t('layout.newLook.groups.team');
      case 'schedule':
        return t('layout.newLook.groups.schedule');
      case 'grading':
        return t('layout.nav.grading');
      case 'billing':
        return t('layout.newLook.groups.billing');
      case 'waivers':
        return t('layout.nav.waivers');
      case 'organisation':
        return t('layout.newLook.groups.organisation');
      case 'notifications':
        return t('layout.nav.notifications');
      default:
        return entry.pages[0].label;
    }
  };

  // Settings opens the School page, the same place the profile menu's
  // "School settings" goes, and for the same people (AccountMenu.tsx).
  const showSettings = !isCoachOnly;
  const settingsActive = showSettings && isUnder(pathname, '/school') && !current;
  const role = roleLabel(claims?.grants, ownedSchoolId ?? coachSchoolId, t);
  const schoolName = school?.name ?? '';

  return (
    <div className="u8n-shell">
      <nav className="u8n-nav" aria-label={t('layout.newLook.menuLabel')} data-testid="new-look-menu">
        <div className="u8n-nav__school">
          {school?.logoUrl ? (
            <img className="u8n-nav__logo" src={school.logoUrl} alt="" />
          ) : (
            <span className="u8n-nav__logo" aria-hidden="true">
              {schoolName ? initials(schoolName) : 'U8'}
            </span>
          )}
          <span className="u8n-nav__school-name">{schoolName}</span>
        </div>
        <div className="u8n-nav__search">
          <GlobalSearch />
        </div>
        <div className="u8n-nav__items">
          {menu.map((entry) => {
            const active = entry === current;
            return (
              <NavLink
                key={entry.key}
                to={entry.to}
                className={'u8n-nav__link' + (active ? ' u8n-nav__link--active' : '')}
                aria-current={active ? 'page' : undefined}
              >
                <Tile icon={entry.icon} />
                <span className="u8n-nav__label">{groupLabel(entry)}</span>
                {entry.group === 'notifications' && hasUnread ? <span className="u8n-nav__dot" aria-hidden="true" /> : null}
              </NavLink>
            );
          })}
        </div>
        <div className="u8n-nav__spacer" />
        <div className="u8n-nav__foot">
          {showSettings ? (
            <Link
              to="/school"
              className={'u8n-nav__link' + (settingsActive ? ' u8n-nav__link--active' : '')}
              aria-current={settingsActive ? 'page' : undefined}
            >
              <Tile icon="settings" />
              <span className="u8n-nav__label">{t('layout.newLook.groups.settings')}</span>
            </Link>
          ) : null}
          {me ? (
            <div className="u8n-nav__account">
              <AccountMenu me={me} roleLabel={role} placement="up" />
            </div>
          ) : null}
        </div>
      </nav>

      <div className="u8n-main">
        <header className="u8n-bar">
          {current && current.pages.length > 1 ? (
            <nav className="u8n-tabs" aria-label={t('layout.newLook.sectionPages', { section: groupLabel(current) })}>
              {current.pages.map((p) => (
                <Link
                  key={p.to}
                  to={p.to}
                  className={'u8n-tab' + (p === currentPage ? ' u8n-tab--active' : '')}
                  aria-current={p === currentPage ? 'page' : undefined}
                >
                  {p.label}
                </Link>
              ))}
            </nav>
          ) : (
            <span className="u8n-bar__spacer" />
          )}
          <div className="u8n-bar__tools">
            <div className="u8n-phone-only u8n-bar__search">
              <GlobalSearch />
            </div>
            <WhatsNewLink />
            <NotificationsBell />
            <SchoolSwitcher />
            {me ? (
              <div className="u8n-phone-only">
                <AccountMenu me={me} roleLabel={role} compact />
              </div>
            ) : null}
            <LanguagePicker />
          </div>
        </header>
        <div className="u8n-content">
          <VerifyBeltsNotice />
          {isCoachOnly ? null : <TrialBanner />}
          {children}
        </div>
        <div className="u8n-legal">
          <SchoolFooter />
        </div>
      </div>
    </div>
  );
}

function Tile({ icon }: { icon: MenuIcon }) {
  return (
    <span className="u8n-nav__tile" aria-hidden="true">
      <MenuIconSvg icon={icon} />
    </span>
  );
}

/** Up to two letters from the School's name, for the logo tile. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => firstGrapheme(w).toLocaleUpperCase())
    .join('');
}
