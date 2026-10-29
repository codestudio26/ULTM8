import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorBanner, Field, PageHeader, SelectField, Spinner } from '@ultm8/ui';
import { useGradingSchoolId, useIsCoachOnly } from '../auth/AuthContext';
import { useBranches } from '../branches/branchQueries';
import { StudentsTabs } from '../students/StudentsTabs';
import { useT } from '../i18n/I18nProvider';
import { codeErrorText, errorText, useCodeLookup, useQrLookup, useTodayBookings, useTodayClasses, type QrLookup } from './frontDeskQueries';
import { useSchool } from '../schools/schoolQueries';
import { useMyOpenMat } from './openMatQueries';
import { OpenMatDialog } from './OpenMatDialog';
import {
  ClassList,
  CodePad,
  MethodSwitch,
  NameSearch,
  RecentList,
  ScanBox,
  WelcomeCard,
  recentCheckIns,
  timeOf,
  useMinuteTick,
  type CheckInMethod,
  type FrontDeskStudent,
} from './parts';
import { useEndKioskSession, useKioskSessions, useMyKioskCode, useNewKioskCode } from './kioskSession';
import './frontDesk.css';

/**
 * Students → Check-in, for the owner and staff at the desk (DESIGN.md →
 * "Check-in and front-desk mode", staff tab). Today's Classes on the left, the
 * Scan · Code · Name switch in the middle, recent check-ins on the right.
 * After a QR or a name, a welcome card lists today's Classes to tick.
 */
export function CheckInPage() {
  const t = useT();
  const now = useMinuteTick();
  const schoolId = useGradingSchoolId();
  const isCoachOnly = useIsCoachOnly();
  const { data: branchData } = useBranches(schoolId);
  // Closed Branches have no classes to check into (CI9).
  const branches = (branchData?.items ?? []).filter((b) => !b.archivedAt);
  const [branchId, setBranchId] = useState<string>('');
  const today = useTodayClasses(schoolId, branchId || null, now);
  const { byClass: bookingsByClass, ready: bookingsReady } = useTodayBookings(today.classes);
  const qrLookup = useQrLookup(schoolId);
  const codeLookup = useCodeLookup(schoolId);
  const school = useSchool(schoolId);
  const codeDigits = school.data?.checkInCodeDigits === 6 ? 6 : 4;
  // Decision 386: the owner, and staff the owner allows, start an open mat.
  const myOpenMat = useMyOpenMat(schoolId);
  const [startingOpenMat, setStartingOpenMat] = useState(false);
  const openMatBranches = branches.filter((b) => myOpenMat.data?.branchIds == null || myOpenMat.data.branchIds.includes(b.id));

  const [method, setMethod] = useState<CheckInMethod>('scan');
  const [who, setWho] = useState<{ student: FrontDeskStudent; qr: QrLookup | null } | null>(null);
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
            {myOpenMat.data?.canStart ? (
              <button type="button" className="fd-pill fd-pill--line" onClick={() => setStartingOpenMat(true)}>
                {t('frontDesk.classes.openMat')}
              </button>
            ) : null}
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
              bookingsReady={bookingsReady}
              qr={who.qr}
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
                    setMsg({ kind: 'ok', text: t('frontDesk.scan.checking') });
                    qrLookup.mutate(token, {
                      onSuccess: (r) => {
                        setMsg(null);
                        setWho({
                          student: { id: r.studentId, firstName: r.firstName, surname: r.surname, profilePhotoUrl: r.profilePhotoUrl },
                          qr: { lookupToken: r.lookupToken, expiresAt: Date.parse(r.expiresAt) },
                        });
                      },
                      onError: (err) => setMsg({ kind: 'bad', text: errorText(err, t('frontDesk.scan.notOurs')) }),
                    });
                  }}
                />
              ) : method === 'code' ? (
                <CodePad
                  title={t('frontDesk.code.staffTitle')}
                  hint={t('frontDesk.code.staffHint', { digits: codeDigits })}
                  length={codeDigits}
                  onCode={(code) => {
                    setMsg({ kind: 'ok', text: t('frontDesk.code.checking') });
                    codeLookup.mutate(code, {
                      onSuccess: (r) => {
                        setMsg(null);
                        setWho({
                          student: { id: r.studentId, firstName: r.firstName, surname: r.surname, profilePhotoUrl: r.profilePhotoUrl },
                          qr: { lookupToken: r.lookupToken, expiresAt: Date.parse(r.expiresAt) },
                        });
                      },
                      onError: (err) => setMsg({ kind: 'bad', text: codeErrorText(err, t('frontDesk.code.notFound')) }),
                    });
                  }}
                />
              ) : (
                <NameSearch schoolId={schoolId} onPick={(student) => setWho({ student, qr: null })} />
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
      <FrontDeskTablets schoolId={schoolId} />
      {startingOpenMat ? (
        <OpenMatDialog
          schoolId={schoolId}
          branches={openMatBranches}
          branchId={branchId}
          onClose={() => setStartingOpenMat(false)}
          onStarted={(notified) => {
            setStartingOpenMat(false);
            setMsg({ kind: 'ok', text: t('frontDesk.openMat.started', { count: notified }) });
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The tablets in front-desk mode now, which staff can end from here (a lost
 * tablet, or nobody at the desk with a code), and the caller's own code for
 * leaving one (Decisions 320, 380).
 */
function FrontDeskTablets({ schoolId }: { schoolId: string }) {
  const t = useT();
  const sessions = useKioskSessions(schoolId);
  const end = useEndKioskSession(schoolId);
  const myCode = useMyKioskCode(schoolId);
  const newCode = useNewKioskCode(schoolId);
  const [error, setError] = useState<string | null>(null);
  const items = sessions.data?.items ?? [];
  return (
    <section className="fd-tablets" data-testid="fd-tablets" aria-labelledby="fd-tablets-title">
      <Card>
        <h2 id="fd-tablets-title" className="fd-eyebrow" style={{ marginBottom: 8 }}>
          {t('frontDesk.tablets.title')}
        </h2>
        {myCode.data ? (
          <p className="fd-class__meta" style={{ marginTop: 0 }}>
            {t('frontDesk.tablets.myCode', { code: myCode.data.code })}{' '}
            <button
              type="button"
              className="fd-link"
              disabled={newCode.isPending}
              onClick={() => {
                if (window.confirm(t('frontDesk.tablets.newCodeConfirm'))) newCode.mutate();
              }}
            >
              {t('frontDesk.tablets.newCode')}
            </button>
          </p>
        ) : null}
        {items.length === 0 ? (
          <p className="fd-class__meta">{t('frontDesk.tablets.none')}</p>
        ) : (
          items.map((s) => (
            <div key={s.id} className="fd-recent__row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="fd-recent__name">{s.branchName ?? t('frontDesk.kiosk.wholeSchool')}</div>
                <div className="fd-recent__meta">{t('frontDesk.tablets.startedBy', { name: s.startedByName, time: timeOf(s.startedAt) })}</div>
              </div>
              <button
                type="button"
                className="fd-pill fd-pill--line"
                disabled={end.isPending}
                onClick={() => {
                  setError(null);
                  end.mutate(s.id, { onError: (err) => setError(errorText(err, t('frontDesk.tablets.endFailed'))) });
                }}
              >
                {t('frontDesk.tablets.end')}
              </button>
            </div>
          ))
        )}
        {error ? (
          <p className="fd-msg fd-msg--bad" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
    </section>
  );
}
