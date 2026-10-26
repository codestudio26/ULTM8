import React from 'react';
import { NavLink } from 'react-router-dom';
import { useIsCoachOnly } from '../auth/AuthContext';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

/**
 * "Grading" in the menu opens these tabs (DESIGN.md → "Grading screens":
 * Board · Styles & Belts · Skills · Permissions · Settings). Styles & Belts is
 * the Disciplines page. Permissions is the owner's (Decision 184).
 */
export function GradingTabs() {
  const t = useT();
  const isCoachOnly = useIsCoachOnly();
  const tabs: Array<{ to: string; label: TranslationKey; end?: boolean }> = [
    { to: '/grading', label: 'grading.tabs.board', end: true },
    { to: '/disciplines', label: 'grading.tabs.stylesAndBelts' },
    { to: '/grading/skills', label: 'grading.tabs.skills' },
    ...(isCoachOnly ? [] : [{ to: '/grading/permissions', label: 'grading.tabs.permissions' as TranslationKey }]),
    { to: '/grading/settings', label: 'grading.tabs.settings' },
  ];
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
