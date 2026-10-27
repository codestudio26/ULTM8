import React from 'react';
import { NavLink } from 'react-router-dom';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

/** Students and Check-in sit side by side (DESIGN.md → "Check-in and
 * front-desk mode"). Same tab row as Grading's. */
export function StudentsTabs() {
  const t = useT();
  const tabs: Array<{ to: string; label: TranslationKey; end?: boolean }> = [
    { to: '/students', label: 'students.tabs.students', end: true },
    { to: '/check-in', label: 'students.tabs.checkIn' },
  ];
  return (
    <nav className="ultm8-tabs" aria-label={t('students.tabs.aria')}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `ultm8-tabs__tab${isActive ? ' ultm8-tabs__tab--active' : ''}`}>
          {t(tab.label)}
        </NavLink>
      ))}
    </nav>
  );
}
