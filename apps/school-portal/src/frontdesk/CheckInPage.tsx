import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorBanner, Field, PageHeader, SelectField, Spinner } from '@ultm8/ui';
import { useGradingSchoolId, useIsCoachOnly } from '../auth/AuthContext';
import { useBranches } from '../branches/branchQueries';
import { useStudents } from '../students/studentQueries';
import { StudentsTabs } from '../students/StudentsTabs';
import { useT } from '../i18n/I18nProvider';
import { hasBackend } from './frontDeskFeatures';
import { errorText, useTodayBookings, useTodayClasses } from './frontDeskQueries';
import {
  ClassList,
  CodePad,
  MethodSwitch,
  NameSearch,
  RecentList,
  ScanBox,
  SoonTag,
  WelcomeCard,
  recentCheckIns,
  useMinuteTick,
  useQrStudent,
  type CheckInMethod,
  type FrontDeskStudent,
} from './parts';
import './frontDesk.css';

/**
 * Students → Check-in, for the owner and staff at the desk (DESIGN.md →
 * "Check-in and front-desk mode", staff tab). Today's Classes on the left, the
 * Scan · Code · Name switch in the middle, recent check-ins on the right.
 * After a QR or a name, a welcome card lists today's Classes to tick.
 */
export function CheckInPage() {
  const t = useT();
  useMinuteTick();
  const schoolId = useGradingSchoolId();
  const isCoachOnly = useIsCoachOnly();
  const { data: branchData } = useBranches(schoolId);
  const branches = branchData?.items ?? [];
  const [branchId, setBranchId] = useState<string>('');
  const today = useTodayClasses(schoolId, branchId || null);
  const bookingsByClass = useTodayBookings(today.classes);
  const roster = useStudents(schoolId).data?.items;
  const fromQr = useQrStudent(roster);

  const [method, setMethod] = useState<CheckInMethod>('scan');
  const [who, setWho] = useState<{ student: FrontDeskStudent; qr: { token: string; expiresAt: number } | null } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const recent = useMemo(() => recentCheckIns(today.classes, bookingsByClass, 10), [today.classes, bookingsByClass]);

  if (!schoolId) return null;

  return (
    <>
      <PageHeader
        title={isCoachOnly ? t('frontDesk.page.title') : t('students.title')}
        subtitle={t('frontDesk.page.subtitle')}
        actions={
          <Link to="/front-desk" className="fd-pill fd-pill--line">
            {t('frontDesk.page.openKiosk')}
          </Link>
        }
      />
      {isCoachOnly ? null : <StudentsTabs />}
      {branches.length > 1 ? (
        <div style={{ maxWidth: 260, marginBottom: 12 }}>
          <Field label={t('frontDesk.page.branch')} htmlFor="fd-branch">
            <SelectField
              id="fd-branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={[{ value: '', label: t('frontDesk.page.allBranches') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
            />
          </Field>
        </div>
      ) : null}
      {today.error ? <ErrorBanner message={errorText(today.error, t('frontDesk.classes.loadFailed'))} /> : null}

      <div className="fd-split">
        <section className="fd-classes" aria-labelledby="fd-today">
          <h2 id="fd-today" className="fd-eyebrow">
            {t('frontDesk.classes.today')}
          </h2>
          {today.isLoading ? <Spinner /> : <ClassList classes={today.classes} bookingsByClass={bookingsByClass} schoolId={schoolId} />}
          <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', justifyContent: 'center' }}>
            <button type="button" className="fd-pill fd-pill--line" disabled={!hasBackend('openMat')} title={t('frontDesk.classes.openMatSoon')}>
              {t('frontDesk.classes.openMat')} {hasBackend('openMat') ? null : <SoonTag />}
            </button>
          </div>
        </section>

        <section className="fd-main" aria-label={t('frontDesk.page.checkInAria')}>
          {who ? (
            <WelcomeCard
              key={who.student.id}
              student={who.student}
              schoolId={schoolId}
              classes={today.classes}
              bookingsByClass={bookingsByClass}
              qr={who.qr}
              short={false}
              onBack={() => setWho(null)}
              onDone={() => {
                setWho(null);
                // Who and where is in Recent check-ins; this line only confirms (DESIGN.md, 23 Oct 2026).
                setMsg({ kind: 'ok', text: t('frontDesk.page.checkedIn') });
              }}
            />
          ) : (
            <>
              <MethodSwitch
                value={method}
                onChange={(m) => {
                  setMethod(m);
                  setMsg(null);
                }}
              />
              {method === 'scan' ? (
                <ScanBox
                  title={t('frontDesk.scan.staffTitle')}
                  hint={t('frontDesk.scan.staffHint')}
                  onQr={(token) => {
                    const found = fromQr(token);
                    if (found) setWho(found);
                    else setMsg({ kind: 'bad', text: t('frontDesk.scan.notOurs') });
                  }}
                />
              ) : method === 'code' ? (
                <CodePad title={t('frontDesk.code.staffTitle')} onCode={() => undefined} />
              ) : (
                <NameSearch schoolId={schoolId} short={false} onPick={(student) => setWho({ student, qr: null })} />
              )}
              <div className={`fd-msg${msg ? ` fd-msg--${msg.kind}` : ''}`} aria-live="polite">
                {msg?.text ?? ''}
              </div>
            </>
          )}
        </section>

        <Card className="fd-recent-card">
          <h2 className="fd-eyebrow" style={{ marginBottom: 8 }}>
            {t('frontDesk.recent.title')}
          </h2>
          <RecentList rows={recent} />
        </Card>
      </div>
    </>
  );
}
