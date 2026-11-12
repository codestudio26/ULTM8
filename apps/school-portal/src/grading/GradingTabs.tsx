import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useIsCoachOnly } from '../auth/AuthContext';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

/**
 * "Grading" in the menu opens these tabs (DESIGN.md → "Grading screens":
 * Board · Styles & Belts · Skills · Permissions · Settings). Styles & Belts is
 * the Disciplines page. Permissions is the owner's (Decision 184).
 */
function useTabList(): Array<{ to: string; label: TranslationKey; end?: boolean }> {
  const isCoachOnly = useIsCoachOnly();
  return [
    { to: '/grading', label: 'grading.tabs.board', end: true },
    { to: '/disciplines', label: 'grading.tabs.stylesAndBelts' },
    { to: '/grading/skills', label: 'grading.tabs.skills' },
    ...(isCoachOnly ? [] : [{ to: '/grading/permissions', label: 'grading.tabs.permissions' as TranslationKey }]),
    { to: '/grading/settings', label: 'grading.tabs.settings' },
  ];
}

/** The same tabs for the new look's page header (`NewLookPageHeader`'s
 * `tabs` and `tabsLabel`), the current one marked as NavLink marks it. */
export function useGradingHeaderTabs(): { tabs: Array<{ to: string; label: string; current: boolean }>; tabsLabel: string } {
  const t = useT();
  const { pathname } = useLocation();
  const tabs = useTabList().map((tab) => ({
    to: tab.to,
    label: t(tab.label),
    current: pathname === tab.to || (!tab.end && pathname.startsWith(`${tab.to}/`)),
  }));
  return { tabs, tabsLabel: t('grading.tabs.aria') };
}

export function GradingTabs() {
  const t = useT();
  const tabs = useTabList();
  return (
    <nav className="ultm8-tabs" aria-label={t('grading.tabs.aria')}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `ultm8-tabs__tab${isActive ? ' ultm8-tabs__tab--active' : ''}`}
        >
          {t(tab.label)}
        </NavLink>
      ))}
    </nav>
  );
}
