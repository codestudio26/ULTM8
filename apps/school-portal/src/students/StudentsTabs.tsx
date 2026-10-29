import React from 'react';
import { NavLink } from 'react-router-dom';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { useMaySeeSignUps } from './SignUpsPage';
import { useSignUps } from './signUpQueries';

/** Students and Check-in sit side by side (DESIGN.md → "Check-in and
 * front-desk mode"), with Sign-ups from the tablet for the people who can
 * approve them (Decision 392). Same tab row as Grading's. */
export function StudentsTabs() {
  const t = useT();
  const schoolId = useGradingSchoolId();
  const maySeeSignUps = useMaySeeSignUps(schoolId);
  const waiting = (useSignUps(schoolId, 'WAITING', maySeeSignUps).data?.items ?? []).filter((s) => s.status === 'PENDING').length;
  const tabs: Array<{ to: string; label: TranslationKey; end?: boolean; count?: number }> = [
    { to: '/students', label: 'students.tabs.students', end: true },
    { to: '/check-in', label: 'students.tabs.checkIn' },
    ...(maySeeSignUps ? [{ to: '/students/sign-ups', label: 'students.tabs.signUps' as TranslationKey, count: waiting }] : []),
  ];
  return (
    <nav className="ultm8-tabs" aria-label={t('students.tabs.aria')}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `ultm8-tabs__tab${isActive ? ' ultm8-tabs__tab--active' : ''}`}>
          {t(tab.label)}
          {tab.count ? ` (${tab.count})` : null}
        </NavLink>
      ))}
    </nav>
  );
}
