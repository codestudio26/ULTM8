import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@ultm8/ui';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../lib/Avatar';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { codeErrorText, errorText, type QrLookup } from './frontDeskQueries';
import {
  clearKioskToken,
  isSessionEnded,
  isTabletLocked,
  readKioskToken,
  useKioskCard,
  useKioskCheckIn,
  useKioskInfo,
  useKioskPackRecharges,
  useKioskCodeLookup,
  useKioskQrLookup,
  useKioskResume,
  useKioskStudentSearch,
  useKioskToday,
  useKioskUnlock,
  type KioskClass,
} from './kioskSession';
import { FindMeScreen, SignUpScreen } from './FrontDeskModePage';
import {
  ClassCards,
  CodePad,
  GuestTicks,
  MethodSwitch,
  NameSearchView,
  ScanBox,
  WelcomeCardBody,
  nextClassId,
  timeOf,
  useMinuteTick,
  type DeskBooking,
  type CheckInMethod,
  type FrontDeskStudent,
} from './parts';
import './frontDesk.css';

type Screen = 'home' | 'signup' | 'sent' | 'find';

/** The tablet's short form ("Ana D."): the API sends only the initial. */
function fromKiosk(s: { id: string; firstName: string; surnameInitial: string; profilePhotoUrl?: string | null }): FrontDeskStudent {
  return { id: s.id, firstName: s.firstName, surname: s.surnameInitial, profilePhotoUrl: s.profilePhotoUrl };
}

/**
 * The locked front-desk tablet (DESIGN.md → "Check-in and front-desk mode";
 * Decisions 317, 320, 351, 380). It holds only a front-desk session token,
 * never a staff login, and reads everything through the API's
 * /front-desk/kiosk endpoints: today's Classes at its Branch, names as
 * "Lucas M.", and today's last 10 check-ins. Leaving takes a staff member's
 * own code.
 */
export function KioskApp() {
  const t = useT();
  const now = useMinuteTick();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [hasToken] = useState(() => !!readKioskToken());
  const info = useKioskInfo(hasToken);
  const today = useKioskToday(hasToken && info.isSuccess, now);
  const qrLookup = useKioskQrLookup();
  const codeLookup = useKioskCodeLookup();
  const [screen, setScreen] = useState<Screen>('home');
  const [method, setMethod] = useState<CheckInMethod>('scan');
  const [who, setWho] = useState<{ student: FrontDeskStudent; qr: QrLookup | null } | null>(null);
  const [done, setDone] = useState<{ first: string; classes: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);
  const [unlockedBy, setUnlockedBy] = useState<string | null>(null);
  const ended = isSessionEnded(info.error) || isSessionEnded(today.error);
  const { accessToken, logout } = useAuth();

  // The tablet never keeps a staff login: whoever started it, or signed in on
  // it since, is signed out as it opens.
  useEffect(() => {
    if (hasToken && accessToken) void logout();
  }, [hasToken, accessToken, logout]);

  useEffect(() => {
    if (ended) clearKioskToken();
  }, [ended]);

  // Too many wrong member codes locked the tablet (Decision 417): whatever
  // heard so fetches the session again, which shows the locked screen.
  const refreshLock = () => void queryClient.invalidateQueries({ queryKey: ['kiosk', 'session'] });
  const todayLocked = isTabletLocked(today.error);
  useEffect(() => {
    if (todayLocked) void queryClient.invalidateQueries({ queryKey: ['kiosk', 'session'] });
  }, [todayLocked, queryClient]);

  // "You're in" goes back to check-in by itself.
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(null), 6000);
    return () => window.clearTimeout(id);
  }, [done]);

  function leave() {
    queryClient.removeQueries({ queryKey: ['kiosk'] });
    navigate('/login', { replace: true });
  }

  if (unlockedBy !== null) {
    return (
      <KioskMessage title={t('frontDesk.tablet.unlockedTitle', { name: unlockedBy })} body={t('frontDesk.tablet.unlockedBody')}>
        <button type="button" className="fd-pill fd-pill--go" onClick={leave}>
          {t('frontDesk.tablet.staffSignIn')}
        </button>
      </KioskMessage>
    );
  }
  if (!hasToken || ended) {
    return (
      <KioskMessage
        title={hasToken ? t('frontDesk.tablet.endedTitle') : t('frontDesk.tablet.noSessionTitle')}
        body={hasToken ? t('frontDesk.tablet.endedBody') : t('frontDesk.tablet.noSessionBody')}
      >
        <button type="button" className="fd-pill fd-pill--go" onClick={leave}>
          {t('frontDesk.tablet.staffSignIn')}
        </button>
      </KioskMessage>
    );
  }
  if (info.data?.locked) {
    return (
      <LockedScreen
        digits={info.data.checkInCodeDigits}
        onResumed={() => {
          setMsg(null);
          setWho(null);
        }}
      />
    );
  }
  if (info.isPending || (today.isPending && !today.error)) {
    return (
      <div className="fd-kiosk" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }
  if (!info.data || !today.data) {
    return (
      <KioskMessage title={t('frontDesk.tablet.loadFailed')} body="">
        <button type="button" className="fd-pill fd-pill--line" onClick={() => window.location.reload()}>
          {t('common.tryAgain')}
        </button>
      </KioskMessage>
    );
  }

  const session = info.data;
  const classes = today.data.classes;
  const branchName = session.branchName ?? t('frontDesk.kiosk.wholeSchool');
  const next = classes.find((c) => c.id === nextClassId(classes, now));

  if (screen === 'signup')
    return (
      <SignUpScreen
        onBack={() => setScreen('home')}
        onSent={() => setScreen('sent')}
        onFind={() => setScreen('find')}
        visitorsOn={info.data?.visitorsOn ?? false}
        heardFromOptions={info.data?.heardFromOptions ?? null}
        medicalInfoOn={info.data?.medicalInfoOn ?? false}
        schoolName={session.schoolName}
      />
    );
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
      <div className="fd-kiosk">
        <aside className="fd-kiosk__side">
          <div className="fd-kiosk__school">
            <span className="fd-kiosk__mark" aria-hidden="true">
              {session.schoolName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <div className="fd-class__name">{session.schoolName}</div>
              <div className="fd-class__meta">{session.branchName ? t('frontDesk.kiosk.branchLine', { branch: branchName }) : branchName}</div>
            </div>
          </div>
          <div>
            <div className="fd-kiosk__clock">{new Date(now).toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="fd-class__meta" style={{ marginTop: 6 }}>
              {new Date(now).toLocaleDateString(formatLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
          {next ? (
            <div className="fd-kiosk__next">
              {t(new Date(next.startDate).getTime() <= now ? 'frontDesk.kiosk.onNow' : 'frontDesk.kiosk.next', {
                time: timeOf(next.startDate),
                title: next.title,
              })}
            </div>
          ) : null}
          <h2 className="fd-eyebrow fd-kiosk__today">{t('frontDesk.kiosk.todayAt', { branch: branchName })}</h2>
          <div className="fd-kiosk__list">
            <ClassCards rows={classes.map((c) => ({ cls: c, taken: c.seatsTaken, checkedIn: c.checkedIn, coach: c.coachName }))} />
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
                  setMsg(null);
                  qrLookup.mutate(token, {
                    onSuccess: (r) => setWho({ student: fromKiosk(r.student), qr: { lookupToken: r.lookupToken, expiresAt: Date.parse(r.expiresAt) } }),
                    onError: (err) => setMsg(errorText(err, t('frontDesk.scan.notOurs'))),
                  });
                }}
              />
            ) : method === 'code' ? (
              <CodePad
                title={t('frontDesk.code.kioskTitle')}
                hint={t('frontDesk.code.hint', { digits: session.checkInCodeDigits })}
                length={session.checkInCodeDigits}
                onCode={(code) => {
                  setMsg(null);
                  codeLookup.mutate(code, {
                    // Like a scanned QR, the lookup lets the check-in record how they came in.
                    onSuccess: (r) => setWho({ student: fromKiosk(r.student), qr: { lookupToken: r.lookupToken, expiresAt: Date.parse(r.expiresAt) } }),
                    onError: (err) => {
                      if (isTabletLocked(err)) refreshLock();
                      setMsg(codeErrorText(err, t('frontDesk.code.notFound')));
                    },
                  });
                }}
              />
            ) : (
              <KioskNameSearch onPick={(student) => setWho({ student, qr: null })} />
            )}
            <div className="fd-msg fd-msg--bad" aria-live="polite">
              {msg ?? ''}
            </div>
          </div>
          <div className="fd-kiosk__strip" data-testid="fd-strip">
            <span className="fd-class__meta">{t('frontDesk.kiosk.checkedInToday')}</span>
            {today.data.recent.map((r) => (
              <span key={r.id} className="fd-chip">
                <Avatar firstName={r.firstName} surname={r.surnameInitial} size={28} />
                {r.surnameInitial ? `${r.firstName} ${r.surnameInitial}.` : r.firstName} <span className="fd-class__meta">{timeOf(r.at)}</span>
              </span>
            ))}
          </div>
        </main>
      </div>

      {who ? (
        <div className="fd-veil">
          <div className="fd-dialog" role="dialog" aria-modal="true" aria-label={t('frontDesk.welcome.aria')}>
            <KioskWelcome
              key={who.student.id}
              student={who.student}
              qr={who.qr}
              classes={classes}
              opensMinutesBefore={session.checkInOpensMinutesBeforeStart}
              closesMinutesAfterStart={session.checkInClosesMinutesAfterStart ?? null}
              severalClasses={session.checkInSeveralClasses}
              onBack={() => setWho(null)}
              onDone={(ids) => {
                setDone({
                  first: who.student.firstName,
                  classes: classes
                    .filter((c) => ids.includes(c.id))
                    .map((c) => `${c.title} · ${timeOf(c.startDate)}`)
                    .join(', '),
                });
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
        <ExitDialog
          digits={session.checkInCodeDigits}
          onStay={() => setExiting(false)}
          onUnlocked={(name) => {
            clearKioskToken();
            setExiting(false);
            setUnlockedBy(name);
          }}
        />
      ) : null}
    </div>
  );
}

function KioskMessage({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="fd-kiosk" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="fd-dialog fd-dialog--small" role="status">
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400 }}>{title}</h1>
        {body ? <p className="fd-class__meta">{body}</p> : null}
        {children}
      </div>
    </div>
  );
}

/** Name search on the tablet: the API returns at most 8, as "Lucas M.". */
function KioskNameSearch({ onPick }: { onPick: (s: FrontDeskStudent) => void }) {
  const [term, setTerm] = useState('');
  const { data, isFetching } = useKioskStudentSearch(term);
  return (
    <NameSearchView
      term={term}
      onTerm={setTerm}
      items={(data?.items ?? []).map(fromKiosk)}
      more={data?.more ? true : null}
      searching={isFetching}
      short
      onPick={onPick}
    />
  );
}

/** The welcome card on the tablet, from its one card endpoint. */
function KioskWelcome({
  student,
  qr,
  classes,
  opensMinutesBefore,
  closesMinutesAfterStart,
  severalClasses,
  onBack,
  onDone,
}: {
  student: FrontDeskStudent;
  qr: QrLookup | null;
  classes: KioskClass[];
  opensMinutesBefore: number;
  closesMinutesAfterStart: number | null;
  severalClasses: boolean;
  onBack: () => void;
  onDone: (classIds: string[]) => void;
}) {
  const card = useKioskCard(student.id, qr?.lookupToken ?? null);
  const checkIn = useKioskCheckIn();
  const recharge = useKioskPackRecharges();
  if (!card.data) {
    return (
      <div className="fd-welcome" data-testid="fd-welcome">
        {card.error ? <p className="fd-msg fd-msg--bad">{errorText(card.error, '')}</p> : <Spinner />}
      </div>
    );
  }
  const data = card.data;
  const mine = new Map<string, DeskBooking>(
    data.bookings.map((b) => [b.classId, { bookingId: b.bookingId, status: b.status, hasGuests: b.guests.length > 0 }]),
  );
  return (
    <WelcomeCardBody
      student={{ ...student, profilePhotoUrl: data.student.profilePhotoUrl }}
      classes={classes}
      mine={mine}
      info={{ membershipStatus: data.membershipStatus, waivers: { signed: data.waiverSigned, toSign: data.waiversToSign }, progress: data.progress, memberNotes: data.memberNotes }}
      checkIn={checkIn}
      recharge={recharge}
      renderGuests={(bookingId, disabled, picked, onToggle) => (
        <GuestTicks
          guests={(data.bookings.find((b) => b.bookingId === bookingId)?.guests ?? []).map((g) => ({
            ...g,
            name: g.name ?? null,
            checkedInAt: g.checkedInAt ?? null,
          }))}
          disabled={disabled}
          picked={picked}
          onToggle={onToggle}
        />
      )}
      qr={qr}
      // Found by name, the tablet only checks in to Classes already booked (Decision 388).
      mayBook={qr !== null}
      short
      onBack={onBack}
      onDone={onDone}
      opensMinutesBefore={opensMinutesBefore}
      closesMinutesAfterStart={closesMinutesAfterStart}
      severalClasses={severalClasses}
    />
  );
}

/** Too many wrong member codes in a row (Decision 417): only a staff member's
 * own code lets the tablet carry on in front-desk mode. */
function LockedScreen({ digits, onResumed }: { digits: number; onResumed: () => void }) {
  const t = useT();
  const resume = useKioskResume();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  return (
    <KioskMessage title={t('frontDesk.tablet.lockedTitle')} body={t('frontDesk.tablet.lockedBody')}>
      <CodePad
        title={t('frontDesk.tablet.lockedCodeTitle')}
        hint={t('frontDesk.exit.codeHint')}
        length={digits}
        staffCode
        onCode={(code) => {
          setError(null);
          resume.mutate(code, {
            onSuccess: () => {
              onResumed();
              void queryClient.invalidateQueries({ queryKey: ['kiosk'] });
            },
            onError: (err) => {
              // Too many wrong staff codes end the session, as on the exit screen (Decision 388).
              if (isSessionEnded(err)) void queryClient.invalidateQueries({ queryKey: ['kiosk'] });
              setError(errorText(err, t('frontDesk.exit.failed')));
            },
          });
        }}
      />
      <div className="fd-msg fd-msg--bad" aria-live="polite">
        {error ?? ''}
      </div>
    </KioskMessage>
  );
}

/** Leaving front-desk mode takes a staff member's own code (Decision 320). */
function ExitDialog({ digits, onStay, onUnlocked }: { digits: number; onStay: () => void; onUnlocked: (name: string) => void }) {
  const t = useT();
  const unlock = useKioskUnlock();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fd-veil">
      <div className="fd-dialog fd-dialog--small" role="dialog" aria-modal="true" aria-labelledby="fd-exit-title">
        <h2 id="fd-exit-title" style={{ margin: 0, fontSize: 26, fontWeight: 400 }}>
          {t('frontDesk.exit.title')}
        </h2>
        <CodePad
          title={t('frontDesk.exit.codeTitle')}
          hint={t('frontDesk.exit.codeHint')}
          length={digits}
          staffCode
          onCode={(code) => {
            setError(null);
            unlock.mutate(code, {
              onSuccess: (r) => onUnlocked(r.unlockedBy),
              onError: (err) => {
                // Too many wrong codes ended the session (Decision 388): show the ended screen now.
                if (isSessionEnded(err)) void queryClient.invalidateQueries({ queryKey: ['kiosk'] });
                setError(errorText(err, t('frontDesk.exit.failed')));
              },
            });
          }}
        />
        <div className="fd-msg fd-msg--bad" aria-live="polite">
          {error ?? ''}
        </div>
        <button type="button" className="fd-pill fd-pill--line" onClick={onStay}>
          {t('frontDesk.exit.stay')}
        </button>
      </div>
    </div>
  );
}
