import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useStudents } from './studentQueries';
import { useLogAttendance, useLogClasses, type LogClassItem } from './attendanceQueries';
import { useRosterStudents, useRosters } from './rosterQueries';

/** A class's start time, in the School's time zone the API names. */
function timeOf(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleTimeString(formatLocale(), { hour: 'numeric', minute: '2-digit', timeZone });
  } catch {
    return new Date(iso).toLocaleTimeString(formatLocale(), { hour: 'numeric', minute: '2-digit' });
  }
}

/** A YYYY-MM-DD day, shown in the viewer's language (a calendar day, no time zone). */
export function formatDayOnly(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * "+ Log attendance" (Decision 317 item 4, backlog 5.7): pick the student
 * (fixed on their profile), a day up to 30 days back and a class on that day
 * that has started. The API books it if needed, paid for like any staff
 * booking (a Class Pack credit), and checks it in like a normal check-in,
 * recorded as logged by this staff member. A class they already attended
 * can't be picked.
 */
export function LogAttendanceModal({
  schoolId,
  student,
  onClose,
  onDone,
}: {
  schoolId: string;
  student?: { id: string; name: string };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const students = useStudents(student ? null : schoolId, 'ACTIVE');
  const [studentId, setStudentId] = useState(student?.id ?? '');
  // Decision 317 item 6: narrow the student picker to one roster.
  const [rosterId, setRosterId] = useState('');
  const rosters = useRosters(student ? null : schoolId);
  const rosterMembers = useRosterStudents(student ? null : schoolId, rosterId || null);
  // Null: the API lists today, the School's (its own time zone).
  const [date, setDate] = useState<string | null>(null);
  const [classId, setClassId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const classes = useLogClasses(schoolId, date, studentId || null);
  const range = classes.data;
  const logAttendance = useLogAttendance(schoolId);

  const items: LogClassItem[] = classes.isPlaceholderData ? [] : classes.data?.items ?? [];
  const picked = items.find((c) => c.id === classId);
  const nameOf = (id: string) => {
    if (student) return student.name;
    const s = students.data?.items.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.surname}`.trim() : '';
  };

  async function submit() {
    if (!studentId || !picked) return;
    setError(null);
    try {
      await logAttendance.mutateAsync({ studentId, classId: picked.id });
      onDone(t('students.attendance.log.done', { name: nameOf(studentId), title: picked.title }));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('students.attendance.log.failed'));
    }
  }

  return (
    <Modal title={student ? t('students.attendance.log.titleFor', { name: student.name }) : t('students.attendance.log.title')} onClose={onClose}>
      <p className="ultm8-field__hint" style={{ marginTop: 0 }}>{t('students.attendance.log.intro')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {!student && (rosters.data?.items ?? []).length > 0 ? (
        <Field label={t('students.rosters.filterLabel')} htmlFor="log-attendance-roster">
          <SelectField
            id="log-attendance-roster"
            value={rosterId}
            onChange={(e) => {
              setRosterId(e.target.value);
              setStudentId('');
              setClassId('');
            }}
            options={[{ value: '', label: t('students.rosters.filterAll') }, ...(rosters.data?.items ?? []).map((r) => ({ value: r.id, label: r.name }))]}
          />
        </Field>
      ) : null}
      {!student ? (
        <Field label={t('students.attendance.log.student')} htmlFor="log-attendance-student">
          <SelectField
            id="log-attendance-student"
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value);
              setClassId('');
            }}
            options={[
              { value: '', label: t('students.attendance.log.studentPlaceholder') },
              ...(students.data?.items ?? [])
                .filter((s) => !rosterId || !!rosterMembers.data?.studentIds.includes(s.id))
                .map((s) => ({ value: s.id, label: `${s.firstName} ${s.surname}`.trim() })),
            ]}
          />
        </Field>
      ) : null}
      {range ? (
        <Field
          label={t('students.attendance.log.date')}
          htmlFor="log-attendance-date"
          hint={t('students.attendance.log.dateHint', { from: formatDayOnly(range.earliestDay), to: formatDayOnly(range.today) })}
        >
          <TextField
            id="log-attendance-date"
            type="date"
            min={range.earliestDay}
            max={range.today}
            value={date ?? range.date}
            onChange={(e) => {
              const v = e.target.value;
              if (v && v >= range.earliestDay && v <= range.today) {
                setDate(v);
                setClassId('');
              }
            }}
          />
        </Field>
      ) : null}
      {classes.isLoading || classes.isPlaceholderData ? (
        <Spinner />
      ) : classes.error ? (
        <ErrorBanner message={classes.error instanceof ApiError ? classes.error.message : t('students.attendance.log.loadFailed')} />
      ) : items.length === 0 ? (
          <p data-testid="log-attendance-no-classes">{t('students.attendance.log.noClasses')}</p>
        ) : (
          <Field label={t('students.attendance.log.class')} htmlFor="log-attendance-class">
            <SelectField
              id="log-attendance-class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              options={[
                { value: '', label: t('students.attendance.log.classPlaceholder') },
                ...items.map((c) => {
                  const time = timeOf(c.startDate, classes.data!.timeZone);
                  return {
                    value: c.id,
                    label: c.attended ? t('students.attendance.log.attended', { title: c.title, time }) : t('students.attendance.log.option', { title: c.title, time }),
                  };
                }),
              ]}
            />
          </Field>
        )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={submit} disabled={!studentId || !picked || picked.attended} loading={logAttendance.isPending}>
          {t('students.attendance.log.submit')}
        </Button>
      </div>
    </Modal>
  );
}
