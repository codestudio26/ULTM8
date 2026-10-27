import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '@ultm8/ui';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useBranches } from '../branches/branchQueries';
import { useSchool } from '../schools/schoolQueries';
import { useStudents } from '../students/studentQueries';
import { Avatar } from '../lib/Avatar';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { hasBackend } from './frontDeskFeatures';
import { useTodayBookings, useTodayClasses } from './frontDeskQueries';
import { findByPersonalCode, findMe, submitSignUp, type SignUpInput } from './kioskApi';
import {
  ClassList,
  CodePad,
  MethodSwitch,
  NameSearch,
  ScanBox,
  SoonTag,
  WelcomeCard,
  nextClassId,
  recentCheckIns,
  shortName,
  timeOf,
  useMinuteTick,
  useQrStudent,
  type CheckInMethod,
  type FrontDeskStudent,
} from './parts';
import './frontDesk.css';

type Screen = 'start' | 'home' | 'signup' | 'sent' | 'find';

const EMPTY_SIGN_UP: SignUpInput = {
  kind: 'VISITOR',
  firstName: '',
  surname: '',
  dateOfBirth: '',
  gender: '',
  phone: '',
  email: '',
  heardFrom: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelationship: '',
};

/**
 * Front-desk mode: the full-screen tablet members use to check themselves in
 * (DESIGN.md → "Check-in and front-desk mode"; Decisions 317, 320, 351).
 * Staff pick the Branch, then the tablet shows today's Classes there, Scan ·
 * Code · Name, Sign up and Exit. Names show as "Lucas M." and recent
 * check-ins are today's last 10.
 *
 * Until the locked session exists (FRONT_DESK_BACKEND.kioskSession) this runs
 * in the staff member's own login, says so in a banner, and Exit just asks
 * to confirm.
 */
export function FrontDeskModePage() {
  const t = useT();
  const now = useMinuteTick();
  const navigate = useNavigate();
  const schoolId = useGradingSchoolId();
  const school = useSchool(schoolId).data;
  const branches = (useBranches(schoolId).data?.items ?? []).filter((b) => !b.archivedAt);
  const [screen, setScreen] = useState<Screen>('start');
  const [branchId, setBranchId] = useState<string | null>(null);
  const today = useTodayClasses(schoolId, screen === 'start' ? null : branchId);
  const bookingsByClass = useTodayBookings(today.classes);
  const roster = useStudents(schoolId).data?.items;
  const fromQr = useQrStudent(roster);
  const [method, setMethod] = useState<CheckInMethod>('scan');
  const [who, setWho] = useState<{ student: FrontDeskStudent; qr: { token: string; expiresAt: number } | null } | null>(null);
  const [done, setDone] = useState<{ first: string; classes: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  // "You're in" goes back to check-in by itself.
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(null), 6000);
    return () => window.clearTimeout(id);
  }, [done]);

  const recent = useMemo(() => recentCheckIns(today.classes, bookingsByClass, 10), [today.classes, bookingsByClass]);
  const branchName = branches.find((b) => b.id === branchId)?.name ?? '';
  const next = today.classes.find((c) => c.id === nextClassId(today.classes, now));

  if (!schoolId) return null;

  if (screen === 'start') {
    return (
      <div className="fd-kiosk" style={{ alignItems: 'center', justifyContent: 'center', background: 'var(--surface-0)' }}>
        <div className="fd-dialog fd-dialog--small" style={{ textAlign: 'left', alignItems: 'stretch' }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400 }}>{t('frontDesk.kiosk.startTitle')}</h1>
          <p className="fd-class__meta" style={{ margin: 0 }}>
            {t('frontDesk.kiosk.startBody')}
          </p>
          <div role="radiogroup" aria-label={t('frontDesk.kiosk.branch')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {branches.length === 0 ? <Spinner /> : null}
            {branches.map((b) => (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={b.id === branchId}
                className="fd-tick"
                style={{ background: b.id === branchId ? 'var(--surface-1)' : undefined, boxShadow: b.id === branchId ? 'inset 0 0 0 2px #9fd3b2' : undefined }}
                onClick={() => setBranchId(b.id)}
              >
                <span className="fd-tick__box" aria-hidden="true">
                  {b.id === branchId ? '●' : ''}
                </span>
                <span className="fd-tick__name">{b.name}</span>
              </button>
            ))}
          </div>
          <p className="fd-class__meta" style={{ margin: 0 }}>
            {hasBackend('kioskSession') ? t('frontDesk.kiosk.startLocked') : t('frontDesk.kiosk.startNotLocked')}
          </p>
          <button type="button" className="fd-pill fd-pill--go" disabled={!branchId} onClick={() => setScreen('home')}>
            {t('frontDesk.kiosk.start')}
          </button>
          <button type="button" className="fd-pill fd-pill--line" onClick={() => navigate('/check-in')}>
            {t('frontDesk.kiosk.cancel')}
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'signup') return <SignUpScreen onBack={() => setScreen('home')} onSent={() => setScreen('sent')} onFind={() => setScreen('find')} />;
  if (screen === 'find') return <FindMeScreen onBack={() => setScreen('home')} onSignUp={() => setScreen('signup')} />;
  if (screen === 'sent') {
    return (
      <div className="fd-kiosk" style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, textAlign: 'center' }}>
        <span className="fd-done" aria-hidden="true">
          ✓
        </span>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 400 }}>{t('frontDesk.signUp.sentTitle')}</h1>
        <p className="fd-class__meta">{t('frontDesk.signUp.sentBody')}</p>
        <button type="button" className="fd-pill fd-pill--line" onClick={() => setScreen('home')}>
          {t('frontDesk.kiosk.backToCheckIn')}
        </button>
      </div>
    );
  }

  return (
    <div className="fd-kiosk-wrap">
      {hasBackend('kioskSession') ? null : (
        <div className="fd-banner" role="status">
          {t('frontDesk.kiosk.notLockedBanner')}
        </div>
      )}
      <div className="fd-kiosk">
        <aside className="fd-kiosk__side">
          <div className="fd-kiosk__school">
            <span className="fd-kiosk__mark" aria-hidden="true">
              {(school?.name ?? '?').slice(0, 2).toUpperCase()}
            </span>
            <div>
              <div className="fd-class__name">{school?.name}</div>
              <div className="fd-class__meta">{t('frontDesk.kiosk.branchLine', { branch: branchName })}</div>
            </div>
          </div>
          <div>
            <div className="fd-kiosk__clock">{new Date(now).toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="fd-class__meta" style={{ marginTop: 6 }}>
              {new Date(now).toLocaleDateString(formatLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
          {next ? <div className="fd-kiosk__next">{t(new Date(next.startDate).getTime() <= now ? 'frontDesk.kiosk.onNow' : 'frontDesk.kiosk.next', { time: timeOf(next.startDate), title: next.title })}</div> : null}
          <h2 className="fd-eyebrow fd-kiosk__today">{t('frontDesk.kiosk.todayAt', { branch: branchName })}</h2>
          <div className="fd-kiosk__list">
            <ClassList classes={today.classes} bookingsByClass={bookingsByClass} schoolId={schoolId} />
          </div>
        </aside>

        <main className="fd-kiosk__body">
          <div className="fd-kiosk__top">
            <MethodSwitch
              value={method}
              onChange={(m) => {
                setMethod(m);
                setMsg(null);
              }}
            />
            <div className="fd-kiosk__actions">
              <button type="button" className="fd-pill fd-pill--soft" onClick={() => setScreen('signup')}>
                <span className="fd-signup-long">{t('frontDesk.kiosk.newHere')} </span>
                {t('frontDesk.kiosk.signUp')}
              </button>
              <button type="button" className="fd-pill fd-pill--line" onClick={() => setExiting(true)}>
                {t('frontDesk.kiosk.exit')}
              </button>
            </div>
          </div>
          <div className="fd-kiosk__center">
            {method === 'scan' ? (
              <ScanBox
                title={t('frontDesk.scan.kioskTitle')}
                hint={t('frontDesk.scan.kioskHint')}
                onQr={(token) => {
                  const found = fromQr(token);
                  if (found) setWho(found);
                  else setMsg(t('frontDesk.scan.notOurs'));
                }}
              />
            ) : method === 'code' ? (
              <CodePad
                title={t('frontDesk.code.kioskTitle')}
                onCode={(code) => {
                  findByPersonalCode(code)
                    .then((s) => setWho({ student: { id: s.studentId, firstName: s.firstName, surname: s.surname, profilePhotoUrl: s.profilePhotoUrl }, qr: null }))
                    .catch(() => setMsg(t('frontDesk.code.notFound')));
                }}
              />
            ) : (
              <NameSearch schoolId={schoolId} short onPick={(student) => setWho({ student, qr: null })} />
            )}
            <div className="fd-msg fd-msg--bad" aria-live="polite">
              {msg ?? ''}
            </div>
          </div>
          <div className="fd-kiosk__strip" data-testid="fd-strip">
            <span className="fd-class__meta">{t('frontDesk.kiosk.checkedInToday')}</span>
            {recent.map((r) => (
              <span key={r.id} className="fd-chip">
                <Avatar firstName={r.firstName} surname={r.surname} size={28} />
                {shortName(r)} <span className="fd-class__meta">{timeOf(r.at)}</span>
              </span>
            ))}
          </div>
        </main>
      </div>

      {who ? (
        <div className="fd-veil">
          <div className="fd-dialog" role="dialog" aria-modal="true" aria-label={t('frontDesk.welcome.aria')}>
            <WelcomeCard
              key={who.student.id}
              student={who.student}
              schoolId={schoolId}
              classes={today.classes}
              bookingsByClass={bookingsByClass}
              qr={who.qr}
              short
              onBack={() => setWho(null)}
              onDone={(ids) => {
                setDone({ first: who.student.firstName, classes: today.classes.filter((c) => ids.includes(c.id)).map((c) => `${c.title} · ${timeOf(c.startDate)}`).join(', ') });
                setWho(null);
              }}
            />
          </div>
        </div>
      ) : null}

      {done ? (
        <div className="fd-veil">
          <div className="fd-dialog fd-dialog--small" role="status">
            <span className="fd-done" aria-hidden="true">
              ✓
            </span>
            <div style={{ fontSize: 32 }}>{t('frontDesk.done.title', { name: done.first })}</div>
            <div style={{ fontSize: 18 }}>{done.classes}</div>
            <div className="fd-class__meta">{t('frontDesk.done.goodClass')}</div>
            <button type="button" className="fd-pill fd-pill--line" onClick={() => setDone(null)}>
              {t('frontDesk.done.ok')}
            </button>
            <div className="fd-class__meta">{t('frontDesk.done.auto')}</div>
          </div>
        </div>
      ) : null}

      {exiting ? (
        <div className="fd-veil">
          <div className="fd-dialog fd-dialog--small" role="dialog" aria-modal="true" aria-labelledby="fd-exit-title">
            <h2 id="fd-exit-title" style={{ margin: 0, fontSize: 26, fontWeight: 400 }}>
              {t('frontDesk.exit.title')}
            </h2>
            <p className="fd-class__meta">
              {hasBackend('kioskSession') ? t('frontDesk.exit.codeHint') : t('frontDesk.exit.notLockedHint')} {hasBackend('kioskSession') ? null : <SoonTag />}
            </p>
            <div className="fd-pair" style={{ width: '100%' }}>
              <button type="button" className="fd-pill fd-pill--line" onClick={() => setExiting(false)}>
                {t('frontDesk.exit.stay')}
              </button>
              <button type="button" className="fd-pill fd-pill--go" onClick={() => navigate('/check-in')}>
                {t('frontDesk.exit.leave')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Sign-up in three steps (Decision 351: it waits for staff approval; a child
 * is signed up only by their Guardian). Sending waits for its backend. */
function SignUpScreen({ onBack, onSent, onFind }: { onBack: () => void; onSent: () => void; onFind: () => void }) {
  const t = useT();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<SignUpInput>(EMPTY_SIGN_UP);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof SignUpInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const ready = hasBackend('signUp');
  const field = (key: keyof SignUpInput, label: string, type = 'text') => (
    <label className="fd-class__meta" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label}
      <input className="ultm8-input" type={type} value={form[key]} onChange={set(key)} style={{ minHeight: 52, fontSize: 16 }} />
    </label>
  );
  const steps = [t('frontDesk.signUp.step1'), t('frontDesk.signUp.step2'), t('frontDesk.signUp.step3')];
  return (
    <div className="fd-page">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="fd-steps">
          {steps.map((s, i) => (
            <span key={s} className={i + 1 === step ? 'on' : ''}>
              {i + 1} · {s}
            </span>
          ))}
        </div>
        <button type="button" className="fd-pill fd-pill--line" onClick={onBack}>
          {t('frontDesk.kiosk.backToCheckIn')}
        </button>
      </div>
      {step === 1 ? (
        <>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 400 }}>{t('frontDesk.signUp.step1')}</h1>
          <div className="fd-switch" role="radiogroup" aria-label={t('frontDesk.signUp.as')} style={{ alignSelf: 'flex-start' }}>
            {(['VISITOR', 'MEMBER'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={form.kind === k} aria-selected={form.kind === k} onClick={() => setForm((f) => ({ ...f, kind: k }))}>
                {k === 'VISITOR' ? t('frontDesk.signUp.visitor') : t('frontDesk.signUp.member')}
              </button>
            ))}
          </div>
          <div className="fd-grid2">
            {field('firstName', t('frontDesk.signUp.firstName'))}
            {field('surname', t('frontDesk.signUp.surname'))}
            {field('dateOfBirth', t('frontDesk.signUp.dateOfBirth'), 'date')}
            <label className="fd-class__meta" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {t('frontDesk.signUp.gender')}
              <select className="ultm8-input" value={form.gender} onChange={set('gender')} style={{ minHeight: 52, fontSize: 16 }}>
                <option value="" />
                <option value="FEMALE">{t('frontDesk.signUp.female')}</option>
                <option value="MALE">{t('frontDesk.signUp.male')}</option>
              </select>
            </label>
          </div>
          <p className="fd-class__meta">
            {t('frontDesk.signUp.childNote')}{' '}
            <button type="button" onClick={onFind} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'var(--text-success)', textDecoration: 'underline', cursor: 'pointer' }}>
              {t('frontDesk.signUp.findMe')}
            </button>
          </p>
        </>
      ) : step === 2 ? (
        <>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 400 }}>{t('frontDesk.signUp.step2')}</h1>
          <div className="fd-grid2">
            {field('phone', t('frontDesk.signUp.phone'), 'tel')}
            {field('email', t('frontDesk.signUp.email'), 'email')}
            {field('heardFrom', t('frontDesk.signUp.heardFrom'))}
          </div>
        </>
      ) : (
        <>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 400 }}>{t('frontDesk.signUp.step3')}</h1>
          <div className="fd-grid3">
            {field('emergencyName', t('frontDesk.signUp.emergencyName'))}
            {field('emergencyPhone', t('frontDesk.signUp.emergencyPhone'), 'tel')}
            {field('emergencyRelationship', t('frontDesk.signUp.emergencyRelationship'))}
          </div>
          <div className="fd-note">
            <span className="fd-note__dot" aria-hidden="true" style={{ background: '#9fd3b2' }} />
            <div>
              <div className="fd-note__title">{t('frontDesk.signUp.approvalTitle')}</div>
              <div className="fd-note__body">{ready ? t('frontDesk.signUp.approvalBody') : t('frontDesk.signUp.soonBody')}</div>
            </div>
          </div>
          {error ? (
            <p className="fd-msg fd-msg--bad" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <button type="button" className="fd-pill fd-pill--line" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
          {t('frontDesk.signUp.back')}
        </button>
        {step < 3 ? (
          <button type="button" className="fd-pill fd-pill--go" style={{ minWidth: 200 }} onClick={() => setStep((s) => s + 1)}>
            {t('frontDesk.signUp.next')}
          </button>
        ) : (
          <button
            type="button"
            className="fd-pill fd-pill--go"
            style={{ minWidth: 200 }}
            disabled={!ready}
            onClick={() => {
              setError(null);
              submitSignUp(form).then(onSent, () => setError(t('frontDesk.signUp.failed')));
            }}
          >
            {t('frontDesk.signUp.send')} {ready ? null : <SoonTag />}
          </button>
        )}
      </div>
    </div>
  );
}

/** Find me (Decision 351): only ever says "you're already a member" and sends
 * the person to check in. It never shows or fills in stored details. */
function FindMeScreen({ onBack, onSignUp }: { onBack: () => void; onSignUp: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [result, setResult] = useState<'member' | 'none' | null>(null);
  const ready = hasBackend('findMe');
  return (
    <div className="fd-kiosk" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 560, maxWidth: 'calc(100% - 32px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 400 }}>{t('frontDesk.findMe.title')}</h1>
        <label className="fd-class__meta" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {t('frontDesk.findMe.name')}
          <input className="ultm8-input" value={name} onChange={(e) => setName(e.target.value)} style={{ minHeight: 52, fontSize: 16 }} />
        </label>
        <label className="fd-class__meta" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {t('frontDesk.signUp.dateOfBirth')}
          <input className="ultm8-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={{ minHeight: 52, fontSize: 16 }} />
        </label>
        {result === 'member' ? (
          <div className="fd-note" style={{ background: 'var(--fill-success)' }}>
            <div>
              <div className="fd-note__title">{t('frontDesk.findMe.memberTitle')}</div>
              <div className="fd-note__body" style={{ color: 'var(--text-success)' }}>
                {t('frontDesk.findMe.memberBody')}
              </div>
            </div>
          </div>
        ) : result === 'none' ? (
          <p className="fd-class__meta">{t('frontDesk.findMe.none')}</p>
        ) : null}
        <p className="fd-class__meta">{t('frontDesk.findMe.privacy')}</p>
        <div className="fd-pair">
          <button type="button" className="fd-pill fd-pill--line" onClick={result === 'none' ? onSignUp : onBack}>
            {result === 'none' ? t('frontDesk.findMe.signUp') : t('frontDesk.kiosk.backToCheckIn')}
          </button>
          {result === 'member' ? (
            <button type="button" className="fd-pill fd-pill--go" onClick={onBack}>
              {t('frontDesk.findMe.goCheckIn')}
            </button>
          ) : (
            <button
              type="button"
              className="fd-pill fd-pill--go"
              disabled={!ready || !name.trim() || !dob}
              onClick={() => findMe(name.trim(), dob).then((r) => setResult(r.alreadyMember ? 'member' : 'none'), () => setResult('none'))}
            >
              {t('frontDesk.findMe.search')} {ready ? null : <SoonTag />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
