import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@ultm8/ui';
import { Avatar } from '../lib/Avatar';
import { QrScanModal } from '../attendance/QrScanModal';
import type { ClassResponse } from '../classes/classQueries';
import type { BookingResponse } from '../bookings/bookingQueries';
import { useInstructors } from '../instructors/instructorQueries';
import { useStudentEligibility } from '../grading/gradingQueries';
import { useSchool } from '../schools/schoolQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { hasBackend } from './frontDeskFeatures';
import {
  QrExpiredError,
  errorText,
  useFrontDeskCheckIn,
  useMembershipStatus,
  useStudentSearch,
  useWaiverStatus,
  type QrLookup,
} from './frontDeskQueries';

export type CheckInMethod = 'scan' | 'code' | 'name';

/** The person a check-in is for, as far as the front desk knows them. */
export interface FrontDeskStudent {
  id: string;
  firstName: string;
  surname: string;
  profilePhotoUrl?: string | null;
}

/** "Lucas M." — how the shared tablet names people (Decision 351). */
export function shortName(p: { firstName: string; surname: string }): string {
  const initial = p.surname.trim()[0];
  return initial ? `${p.firstName} ${initial.toUpperCase()}.` : p.firstName;
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** A Class is still open for check-in until it ends (the API keeps the exact
 * window: Class.qrAttendanceEndAt, else its end). */
export function isOver(c: ClassResponse, now = Date.now()): boolean {
  return new Date(c.qrAttendanceEndAt ?? c.endDate).getTime() < now;
}

/** When check-in opens: the School's set number of minutes before the start
 * (School page, 30 by default), the same rule the API applies. */
export function checkInOpensAt(c: ClassResponse, minutesBefore: number): number {
  return new Date(c.startDate).getTime() - minutesBefore * 60_000;
}

/** The next Class to start, or the one on now. */
export function nextClassId(classes: ClassResponse[], now = Date.now()): string | null {
  return classes.find((c) => new Date(c.endDate).getTime() > now)?.id ?? null;
}

/** Seats taken: booked or checked in, each with their guests, as the API counts them (CI1, CI7). */
function seatsTaken(bookings: BookingResponse[]): number {
  return bookings.filter((b) => b.status === 'UPCOMING' || b.status === 'COMPLETED').reduce((n, b) => n + 1 + (b.attendees?.length ?? 0), 0);
}

export function SoonTag() {
  const t = useT();
  return <span className="fd-soon">{t('frontDesk.soon')}</span>;
}

// ---------------------------------------------------------------------------
// Today's classes
// ---------------------------------------------------------------------------

export function ClassCard({ cls, bookings, coach, next }: { cls: ClassResponse; bookings: BookingResponse[]; coach?: string; next: boolean }) {
  const t = useT();
  const taken = seatsTaken(bookings);
  const checkedIn = bookings.filter((b) => b.status === 'COMPLETED').length;
  const left = cls.capacity == null ? null : Math.max(0, cls.capacity - taken);
  return (
    <div className={`fd-class${next ? ' fd-class--next' : ''}`} data-testid="fd-class">
      <div className="fd-class__time">
        {timeOf(cls.startDate)}
        <div className="fd-class__end">{timeOf(cls.endDate)}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="fd-class__name">{cls.title}</div>
        <div className="fd-class__meta">
          {[
            coach,
            t('frontDesk.classes.checkedIn', { count: checkedIn }),
            left == null ? t('frontDesk.classes.noLimit') : t('frontDesk.classes.placesLeft', { count: left }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {cls.capacity ? (
          <div className="fd-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round((taken / cls.capacity) * 100))}%` }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Coach names by user id. Optional: a role that can't list instructors just
 * doesn't see them. */
export function useCoachNames(schoolId: string | null): Map<string, string> {
  const { data } = useInstructors(schoolId);
  return useMemo(() => new Map((data?.items ?? []).map((i) => [i.userId, `${i.firstName} ${i.surname}`.trim()])), [data]);
}

export function ClassList({
  classes,
  bookingsByClass,
  schoolId,
}: {
  classes: ClassResponse[];
  bookingsByClass: Map<string, BookingResponse[]>;
  schoolId: string | null;
}) {
  const t = useT();
  const coaches = useCoachNames(schoolId);
  const next = nextClassId(classes);
  if (classes.length === 0) return <p className="fd-class__meta">{t('frontDesk.classes.none')}</p>;
  return (
    <>
      {classes.map((c) => (
        <ClassCard key={c.id} cls={c} bookings={bookingsByClass.get(c.id) ?? []} coach={c.instructorId ? coaches.get(c.instructorId) : undefined} next={c.id === next} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Scan · Code · Name
// ---------------------------------------------------------------------------

export function MethodSwitch({ value, onChange }: { value: CheckInMethod; onChange: (m: CheckInMethod) => void }) {
  const t = useT();
  const modes: Array<[CheckInMethod, TranslationKey]> = [
    ['scan', 'frontDesk.method.scan'],
    ['code', 'frontDesk.method.code'],
    ['name', 'frontDesk.method.name'],
  ];
  return (
    <div className="fd-switch" role="tablist" aria-label={t('frontDesk.method.aria')}>
      {modes.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}>
          {t(label)}
        </button>
      ))}
    </div>
  );
}

/** The personal check-in code keypad. Until personal codes exist it's shown
 * switched off, with the reason. */
export function CodePad({ title, onCode }: { title: string; onCode: (code: string) => void }) {
  const t = useT();
  const ready = hasBackend('personalCode');
  const [code, setCode] = useState('');
  const press = (d: string) => setCode((c) => (c.length >= 4 ? c : c + d));
  const keys: Array<{ label: string; aria: string; on: () => void; go?: boolean }> = [
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => ({ label: d, aria: d, on: () => press(d) })),
    { label: '⌫', aria: t('frontDesk.code.delete'), on: () => setCode((c) => c.slice(0, -1)) },
    { label: '0', aria: '0', on: () => press('0') },
    {
      label: '✓',
      aria: t('frontDesk.code.submit'),
      go: true,
      on: () => {
        if (code.length === 4) {
          onCode(code);
          setCode('');
        }
      },
    },
  ];
  return (
    <>
      <div>
        <h2 className="fd-title">
          {title} {ready ? null : <SoonTag />}
        </h2>
        <p className="fd-hint">{ready ? t('frontDesk.code.hint') : t('frontDesk.code.soonHint')}</p>
      </div>
      <div className="fd-dots" aria-label={t('frontDesk.code.entered', { count: code.length })}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < code.length ? 'on' : ''} />
        ))}
      </div>
      <div className="fd-keys">
        {keys.map((k) => (
          <button key={k.aria} type="button" className={`fd-key${k.go ? ' fd-key--go' : ''}`} aria-label={k.aria} onClick={k.on} disabled={!ready}>
            {k.label}
          </button>
        ))}
      </div>
    </>
  );
}

/** The camera square. The camera only turns on when someone taps Start, and
 * stops after one QR. */
export function ScanBox({ title, hint, onQr }: { title: string; hint: string; onQr: (token: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="fd-scan" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
      </div>
      <div>
        <h2 className="fd-title">{title}</h2>
        <p className="fd-hint">{hint}</p>
      </div>
      <button type="button" className="fd-pill fd-pill--line" onClick={() => setOpen(true)}>
        {t('frontDesk.scan.start')}
      </button>
      {open ? (
        <QrScanModal
          onScan={(token) => {
            setOpen(false);
            onQr(token);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

const NAME_RESULTS = 8;

/** Name search. On the shared tablet (`short`) names show as "Lucas M."
 * (Decision 351); staff see full names. */
export function NameSearch({ schoolId, short, onPick }: { schoolId: string | null; short: boolean; onPick: (s: FrontDeskStudent) => void }) {
  const t = useT();
  const [term, setTerm] = useState('');
  const { data, isFetching } = useStudentSearch(schoolId, term);
  const items = data?.items ?? [];
  return (
    <div className="fd-search">
      <label htmlFor="fd-name" className="fd-class__meta">
        {t('frontDesk.name.label')}
      </label>
      <input
        id="fd-name"
        className="ultm8-input"
        autoComplete="off"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={t('frontDesk.name.placeholder')}
        style={{ minHeight: 52, fontSize: 16 }}
      />
      {term.trim().length >= 2 && !isFetching && items.length === 0 ? <p className="fd-hint">{t('frontDesk.name.none')}</p> : null}
      {items.length > NAME_RESULTS ? <p className="fd-hint">{t('frontDesk.name.more', { shown: NAME_RESULTS, count: items.length })}</p> : null}
      {items.slice(0, NAME_RESULTS).map((s) => (
        <button key={s.id} type="button" className="fd-row" onClick={() => onPick(s)}>
          <Avatar firstName={s.firstName} surname={s.surname} photoUrl={s.profilePhotoUrl} size={40} />
          <span className="fd-row__name">{short ? shortName(s) : `${s.firstName} ${s.surname}`}</span>
          <span className="fd-tag">{t('frontDesk.name.member')}</span>
        </button>
      ))}
      {short ? <p className="fd-hint">{t('frontDesk.name.shortNote')}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome card
// ---------------------------------------------------------------------------

const STATUS_TAG: Record<string, { key: TranslationKey; cls: string }> = {
  ACTIVE: { key: 'frontDesk.welcome.membershipActive', cls: 'fd-tag fd-tag--ok' },
  EXPIRED: { key: 'frontDesk.welcome.membershipExpired', cls: 'fd-tag fd-tag--warn' },
  NONE: { key: 'frontDesk.welcome.membershipNone', cls: 'fd-tag fd-tag--warn' },
};

/**
 * Who it is, their membership, waivers and belt progress, and today's Classes
 * to tick. Classes they're booked into start ticked. A Class whose check-in
 * hasn't opened yet is shown but can't be ticked, so Confirm never books a
 * place it can't check into (CI2). Anything the API refuses (no live
 * membership, rank gate, full) comes back as its reason and is shown in place
 * of the Confirm button's result. Waits for today's bookings before ticking
 * anything (CI8).
 */
export function WelcomeCard(props: {
  student: FrontDeskStudent;
  schoolId: string;
  classes: ClassResponse[];
  bookingsByClass: Map<string, BookingResponse[]>;
  bookingsReady: boolean;
  qr: QrLookup | null;
  short: boolean;
  onBack: () => void;
  onDone: (classIds: string[]) => void;
}) {
  const school = useSchool(props.schoolId);
  if (!props.bookingsReady || !school.data) {
    return (
      <div className="fd-welcome" data-testid="fd-welcome">
        <Spinner />
      </div>
    );
  }
  return <WelcomeCardBody {...props} opensMinutesBefore={school.data.checkInOpensMinutesBeforeStart} />;
}

function WelcomeCardBody({
  student,
  schoolId,
  classes,
  bookingsByClass,
  qr,
  short,
  onBack,
  onDone,
  opensMinutesBefore,
}: {
  student: FrontDeskStudent;
  schoolId: string;
  classes: ClassResponse[];
  bookingsByClass: Map<string, BookingResponse[]>;
  qr: QrLookup | null;
  short: boolean;
  onBack: () => void;
  onDone: (classIds: string[]) => void;
  opensMinutesBefore: number;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const now = Date.now();
  const open = classes.filter((c) => !isOver(c, now));
  const canTick = (c: ClassResponse) => checkInOpensAt(c, opensMinutesBefore) <= Date.now();
  const mineIn = (c: ClassResponse, status: string) => (bookingsByClass.get(c.id) ?? []).some((b) => b.studentId === student.id && b.status === status);
  const [picks, setPicks] = useState<string[]>(() => {
    const ready = open.filter(canTick);
    const booked = ready.filter((c) => mineIn(c, 'UPCOMING')).map((c) => c.id);
    if (booked.length) return booked;
    const next = ready.find((c) => !mineIn(c, 'COMPLETED'));
    return next ? [next.id] : [];
  });
  const status = useMembershipStatus(student.id, schoolId);
  const waivers = useWaiverStatus(student.id, schoolId);
  const eligibility = useStudentEligibility(student.id, schoolId);
  const checkIn = useFrontDeskCheckIn();
  const [error, setError] = useState<string | null>(null);

  const progress = (eligibility.data?.items ?? []).map((i) => i.progressBreakdown?.classes).find((c) => c && c.required > 0);
  const tag = status.data ? STATUS_TAG[status.data.status] : null;
  const toggle = (id: string) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // Only Classes that can still be checked into right now are sent.
  const sendable = picks.filter((id) => open.some((c) => c.id === id && canTick(c)));

  function confirm() {
    setError(null);
    checkIn.mutate(
      { studentId: student.id, classIds: sendable, bookingsByClass, qr },
      {
        onSuccess: (ids) => {
          queryClient.invalidateQueries({ queryKey: ['membershipStatus', student.id, schoolId] });
          onDone(ids);
        },
        onError: (err) => setError(err instanceof QrExpiredError ? t('frontDesk.welcome.qrExpired') : errorText(err, t('frontDesk.welcome.failed'))),
      },
    );
  }

  const name = short ? shortName(student) : `${student.firstName} ${student.surname}`;
  return (
    <div className="fd-welcome" data-testid="fd-welcome">
      <div className="fd-welcome__who">
        <Avatar firstName={student.firstName} surname={student.surname} photoUrl={student.profilePhotoUrl} size={64} />
        <div style={{ minWidth: 0 }}>
          <div className="fd-welcome__name">{short ? t('frontDesk.welcome.hello', { name: student.firstName }) : name}</div>
          {progress ? <div className="fd-class__meta">{t('frontDesk.welcome.progress', { counted: progress.counted, required: progress.required })}</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {tag ? <span className={tag.cls}>{t(tag.key)}</span> : null}
        {hasBackend('waiverStatus') && waivers.data ? (
          waivers.data.toSign.length > 0 ? (
            <span className="fd-tag fd-tag--warn">{t('frontDesk.welcome.waiverToSign', { titles: waivers.data.toSign.map((w) => w.title).join(', ') })}</span>
          ) : waivers.data.signed ? (
            <span className="fd-tag fd-tag--ok">{t('frontDesk.welcome.waiverSigned')}</span>
          ) : null
        ) : null}
      </div>
      {progress ? (
        <div className="fd-bar fd-bar--progress" aria-hidden="true">
          <span style={{ width: `${Math.min(100, progress.percent)}%` }} />
        </div>
      ) : null}
      <p className="fd-eyebrow">{t('frontDesk.welcome.tick')}</p>
      {open.length === 0 ? (
        <p className="fd-class__meta">{t('frontDesk.welcome.noOpenClasses')}</p>
      ) : (
        <div className="fd-ticks">
          {open.map((c) => {
            const already = mineIn(c, 'COMPLETED');
            const booked = mineIn(c, 'UPCOMING');
            const notYet = !already && !canTick(c);
            const on = picks.includes(c.id) && !notYet;
            return (
              <button key={c.id} type="button" className="fd-tick" aria-pressed={on} onClick={() => toggle(c.id)} disabled={already || notYet}>
                <span className="fd-tick__box" aria-hidden="true">
                  {on || already ? '✓' : ''}
                </span>
                <span className="fd-tick__time">
                  {timeOf(c.startDate)}–{timeOf(c.endDate)}
                </span>
                <span className="fd-tick__name">{c.title}</span>
                <span className="fd-tick__meta">
                  {already
                    ? t('frontDesk.welcome.alreadyIn')
                    : notYet
                      ? t('frontDesk.welcome.opensAt', { time: timeOf(new Date(checkInOpensAt(c, opensMinutesBefore)).toISOString()) })
                      : booked
                        ? t('frontDesk.welcome.booked')
                        : t('frontDesk.welcome.willBook')}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {error ? (
        <div className="fd-note" role="alert">
          <span className="fd-note__dot" aria-hidden="true" />
          <div>
            <div className="fd-note__title">{t('frontDesk.welcome.notCheckedIn')}</div>
            <div className="fd-note__body">{error}</div>
          </div>
        </div>
      ) : null}
      <div className="fd-pair">
        <button type="button" className="fd-pill fd-pill--line" onClick={onBack}>
          {short ? t('frontDesk.welcome.notMe') : t('frontDesk.welcome.notThisStudent')}
        </button>
        <button type="button" className="fd-pill fd-pill--go" onClick={confirm} disabled={sendable.length === 0 || checkIn.isPending}>
          {sendable.length ? t('frontDesk.welcome.confirm', { count: sendable.length }) : t('frontDesk.welcome.tickOne')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent check-ins
// ---------------------------------------------------------------------------

export interface RecentCheckIn {
  id: string;
  firstName: string;
  surname: string;
  classTitle: string;
  method: string | null | undefined;
  at: string;
}

/** Today's check-ins, newest first. A booking's updatedAt is when it was checked
 * in (prisma/schema.prisma, Booking). */
export function recentCheckIns(classes: ClassResponse[], bookingsByClass: Map<string, BookingResponse[]>, limit: number): RecentCheckIn[] {
  const rows: RecentCheckIn[] = [];
  for (const c of classes) {
    for (const b of bookingsByClass.get(c.id) ?? []) {
      if (b.status !== 'COMPLETED') continue;
      rows.push({ id: b.id, firstName: b.studentFirstName ?? '', surname: b.studentSurname ?? '', classTitle: c.title, method: b.checkInMethod, at: b.updatedAt });
    }
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

const METHOD_LABEL: Record<string, TranslationKey> = {
  SELF_SERVICE: 'frontDesk.recent.methodApp',
  INSTRUCTOR_SCAN: 'frontDesk.recent.methodScan',
  INSTRUCTOR_MANUAL: 'frontDesk.recent.methodName',
};

export function RecentList({ rows }: { rows: RecentCheckIn[] }) {
  const t = useT();
  if (rows.length === 0) return <p className="fd-class__meta">{t('frontDesk.recent.none')}</p>;
  return (
    <div className="fd-recent" data-testid="fd-recent">
      {rows.map((r) => {
        const method = r.method ? METHOD_LABEL[r.method] : undefined;
        return (
          <div key={r.id} className="fd-recent__row">
            <Avatar firstName={r.firstName} surname={r.surname} size={40} />
            <div style={{ minWidth: 0 }}>
              <div className="fd-recent__name">
                {r.firstName} {r.surname}
              </div>
              <div className="fd-recent__meta">{[r.classTitle, method ? t(method) : t('frontDesk.recent.methodCode')].join(' · ')}</div>
            </div>
            <span className="fd-recent__at">{timeOf(r.at)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Re-render once a minute, so "next class" and the tablet clock stay true. */
export function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
