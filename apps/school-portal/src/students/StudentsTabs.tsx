import React from 'react';
import { useLocation } from 'react-router-dom';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { useMaySeeSignUps } from './SignUpsPage';
import { useSignUps } from './signUpQueries';
import { useAttendanceAccess } from './AttendancePage';
import { useMayImport } from './imports/ImportPage';
import { NewLookPageHeader } from '../layout/NewLookPage';

/** Students and Check-in sit side by side (DESIGN.md → "Check-in and
 * front-desk mode"), with Sign-ups from the tablet for the people who can
 * approve them (Decision 392), Attendance (Decision 317) and Growth
 * (backlog 5.8). Same tab row as Grading's. */
/** The Students section's tabs, for the people who may see each one. */
export function useStudentsTabs(): Array<{ to: string; label: TranslationKey; end?: boolean; count?: number }> {
  const schoolId = useGradingSchoolId();
  const maySeeSignUps = useMaySeeSignUps(schoolId);
  // Decision 317 items 3, 4: statistics, or logging past attendance.
  const attendance = useAttendanceAccess(schoolId);
  // Decision 315 items 12, 13: the owner, or Branch Staff with "Import data".
  const mayImport = useMayImport(schoolId);
  const waiting = (useSignUps(schoolId, 'WAITING', maySeeSignUps).data?.items ?? []).filter((s) => s.status === 'PENDING').length;
  return [
    { to: '/students', label: 'students.tabs.students', end: true },
    { to: '/check-in', label: 'students.tabs.checkIn' },
    ...(maySeeSignUps ? [{ to: '/students/sign-ups', label: 'students.tabs.signUps' as TranslationKey, count: waiting }] : []),
    ...(attendance.stats || attendance.log ? [{ to: '/students/attendance', label: 'students.tabs.attendance' as TranslationKey }] : []),
    // Backlog 5.8: the same people as attendance statistics.
    ...(attendance.stats ? [{ to: '/students/growth', label: 'students.tabs.growth' as TranslationKey }] : []),
    ...(mayImport ? [{ to: '/students/import', label: 'imports.tab' as TranslationKey }] : []),
  ];
}

/** The Students section's page header in the new look (Decision 453): the
 * title, the page's own line under it, any actions on the right, and the
 * section's tabs under it, as on the Students list. Used by the Sign-ups,
 * Attendance, Growth and Import tabs. */
export function StudentsHeader({ subtitle, actions }: { subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  const t = useT();
  const tabs = useStudentsTabs();
  const { pathname } = useLocation();
  return (
    <NewLookPageHeader
      title={t('students.title')}
      subtitle={subtitle}
      actions={actions}
      tabs={tabs.map((tab) => ({ to: tab.to, label: tab.count ? `${t(tab.label)} (${tab.count})` : t(tab.label), current: tab.end ? pathname === tab.to : pathname.startsWith(tab.to) }))}
      tabsLabel={t('students.tabs.aria')}
    />
  );
}
