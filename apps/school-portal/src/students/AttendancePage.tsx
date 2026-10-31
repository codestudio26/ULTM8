import React, { useState } from 'react';
import { Button, Card, Checkbox, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useBranches } from '../branches/branchQueries';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { StudentsTabs } from './StudentsTabs';
import { useAttendanceStats } from './attendanceQueries';
import { formatDayOnly, LogAttendanceModal } from './LogAttendanceModal';

/** Who may see the Attendance tab and what's on it: statistics for the owner
 * and Branch Staff the owner lets see them (Decision 317 item 3); "+ Log
 * attendance" for staff who may check people in (item 4). */
export function useAttendanceAccess(schoolId: string | null): { stats: boolean; log: boolean } {
  const access = useMyStaffAccess(schoolId).data;
  if (!access) return { stats: false, log: false };
  return { stats: access.owner || (access.branchStaff && access.access.attendanceStats), log: access.owner || access.access.bookings };
}

function Stat({ label, value, note, testId }: { label: string; value: string; note?: string; testId: string }) {
  return (
    <Card>
      <div style={{ fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)', marginBottom: 4 }}>{label}</div>
      <div data-testid={testId} style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>
        {value}
      </div>
      {note ? <div style={{ fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)', marginTop: 4 }}>{note}</div> : null}
    </Card>
  );
}

/**
 * Students → Attendance (Decision 317 items 3 and 4; backlog 5.6, 5.7):
 * check-ins, students per class and classes per student over the last 30
 * days, with a filter to leave out Trial, Visitor and Friend Pass check-ins,
 * and "+ Log attendance" for a class someone came to but wasn't checked in to.
 */
export function AttendancePage() {
  const t = useT();
  const schoolId = useGradingSchoolId();
  const may = useAttendanceAccess(schoolId);
  const [branchId, setBranchId] = useState('');
  const [excludePasses, setExcludePasses] = useState(false);
  const [logging, setLogging] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const stats = useAttendanceStats(schoolId, { branchId: branchId || undefined, excludePasses }, may.stats);
  const branches = useBranches(may.stats ? schoolId : null);

  if (!schoolId) return null;
  const number = (n: number) => n.toLocaleString(formatLocale(), { maximumFractionDigits: 1 });
  const data = stats.data;
  // Staff see only their own Branches; the API says which.
  const branchOptions = (branches.data?.items ?? []).filter((b) => !data?.branchIds || data.branchIds.includes(b.id) || b.id === branchId);

  return (
    <>
      <PageHeader
        title={t('students.title')}
        subtitle={t('students.attendance.subtitle')}
        actions={may.log ? <Button onClick={() => setLogging(true)}>{t('students.attendance.logButton')}</Button> : undefined}
      />
      <StudentsTabs />
      {done ? <SuccessBanner message={done} /> : null}
      {!may.stats ? (
        <Card>
          <p style={{ margin: 0 }}>{t('students.attendance.noStatsAccess')}</p>
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', marginBottom: 16 }}>
            {branchOptions.length > 1 || branchId ? (
              <Field label={t('students.attendance.branchLabel')} htmlFor="attendance-branch">
                <SelectField
                  id="attendance-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  options={[{ value: '', label: t('students.attendance.allBranches') }, ...branchOptions.map((b) => ({ value: b.id, label: b.name }))]}
                />
              </Field>
            ) : null}
            <Checkbox label={t('students.attendance.excludePasses')} checked={excludePasses} onChange={(e) => setExcludePasses(e.target.checked)} />
          </div>
          {stats.isLoading ? (
            <Spinner />
          ) : stats.error || !data ? (
            <ErrorBanner message={stats.error instanceof ApiError ? stats.error.message : t('students.attendance.loadFailed')} />
          ) : (
            <>
              <p className="ultm8-field__hint" data-testid="attendance-period">
                {t('students.attendance.period', { from: formatDayOnly(data.from), to: formatDayOnly(data.to) })}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                <Stat
                  testId="attendance-check-ins"
                  label={t('students.attendance.checkIns')}
                  value={number(data.checkIns)}
                  note={[
                    data.guestCheckIns ? t('students.attendance.guestsNote', { count: data.guestCheckIns }) : null,
                    data.loggedCheckIns ? t('students.attendance.loggedNote', { count: data.loggedCheckIns }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
                <Stat
                  testId="attendance-students-per-class"
                  label={t('students.attendance.studentsPerClass')}
                  value={number(data.studentsPerClass)}
                  note={t('students.attendance.classesNote', { count: data.classes })}
                />
                <Stat
                  testId="attendance-classes-per-student"
                  label={t('students.attendance.classesPerStudent')}
                  value={number(data.classesPerStudent)}
                  note={t('students.attendance.studentsNote', { count: data.students })}
                />
              </div>
            </>
          )}
        </>
      )}
      {logging ? <LogAttendanceModal schoolId={schoolId} onClose={() => setLogging(false)} onDone={setDone} /> : null}
    </>
  );
}
