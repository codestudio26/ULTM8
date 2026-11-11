import React, { useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { BirthdaysCard } from '../dashboard/BirthdaysCard';
import { ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useSchool } from '../schools/schoolQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { ranksQuery, useRanks, type RankResponse } from '../ranks/rankQueries';
import { useClasses, type ClassResponse } from '../classes/classQueries';
import { useTimetableSlots, type TimetableSlotResponse } from '../timetable/timetableQueries';
import { useBranches } from '../branches/branchQueries';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { classZone, formatInZone, formatTimeInZone } from '../lib/datetime';
import { notificationLink, useNotificationCounts, useNotifications } from '../notifications/notificationQueries';
import { gradingBoardQuery, useGradingBoard, useMyGrading, useStudentEligibility, type GradingBoard, type StudentEligibility } from '../grading/gradingQueries';
import { flattenLadder } from '../grading/ladder';
import { BeltChip } from '../grading/BeltChip';
import { useI18n, useT, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { DashCard } from '../dashboard/DashCard';
import { ClassAvatar } from '../dashboard/DashboardPage';
import { Avatar } from '../lib/Avatar';
import './coachDashboard.css';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
/** Weekday labels are translation keys, resolved at render time. */
const WEEKDAY_LABELS: Record<(typeof WEEKDAYS)[number], TranslationKey> = {
  MONDAY: 'coach.weekdays.monday',
  TUESDAY: 'coach.weekdays.tuesday',
  WEDNESDAY: 'coach.weekdays.wednesday',
  THURSDAY: 'coach.weekdays.thursday',
  FRIDAY: 'coach.weekdays.friday',
  SATURDAY: 'coach.weekdays.saturday',
  SUNDAY: 'coach.weekdays.sunday',
};
const WEEK_MS = 7 * 86_400_000;

/** The coach's own upcoming classes, soonest first (Classes review C17: asked
 * of the server, so a School with many Classes doesn't hide this coach's next
 * one past the first page). The page and the right panel read the same query. */
function useMyUpcomingClasses(schoolId: string, me: string) {
  return useClasses(schoolId, { when: 'upcoming', instructorId: me, limit: 10 });
}

/** The styles this person grades in (Decision 184). */
function useGradedStyles(schoolId: string) {
  const my = useMyGrading(schoolId);
  const disciplines = useDisciplines(schoolId);
  const styles = (disciplines.data?.items ?? []).filter((d) => my.mayGradeStyle(d.id));
  return { styles, isLoading: my.isLoading || disciplines.isLoading, error: my.error ?? disciplines.error };
}

/** An empty card's text: what is missing, then what to do about it. */
function Empty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="u8n-coach__empty">
      <div className="u8n-coach__empty-title">{title}</div>
      {description ? <div>{description}</div> : null}
    </div>
  );
}

/**
 * The coach's dashboard on the web portal (Decision 184), in the new look
 * (Decision 453; the New Portal vision's Coach dashboard and DESIGN.md →
 * "Coach view: nothing shown twice, cards first on a phone"): their grading
 * (the styles they grade in, with how many students are ready), the classes
 * they teach, their notifications, and, when they also train here, their own
 * ranks and progress. The right panel holds their next class and the Ready to
 * grade list. Everything comes from what the API already lets a coach read;
 * it shows students of the coach's own branches only (Decision 168).
 */
export function CoachDashboardPage() {
  const t = useT();
  const schoolId = useCoachSchoolId();
  const { claims } = useAuth();
  const school = useSchool(schoolId);
  const isStudentHere = !!claims?.grants.some((g) => g.role === 'STUDENT' && g.schoolId === schoolId);
  // Decision 425 (Q1): Branch Staff see their branch's classes this week.
  const isInstructor = !!claims?.grants.some((g) => g.role === 'INSTRUCTOR' && g.schoolId === schoolId);
  const isBranchStaff = !!claims?.grants.some((g) => g.role === 'BRANCH_STAFF' && g.schoolId === schoolId);
  // Coaches review CP4: working as an owner, every link here (Grading, Classes)
  // would open the owned School, not this one. Coaching elsewhere is picked in
  // the header's School switcher, which then brings them here.
  const ownedSchoolId = useOwnedSchoolId();

  if (ownedSchoolId) return <Navigate to="/" replace />;
  if (!schoolId) {
    return (
      <>
        <NewLookPageHeader title={t('coach.dashboard.title')} />
        <NewLookPage>
          <section className="u8n-dash__card">
            <Empty title={t('coach.dashboard.notCoachTitle')} description={t('coach.dashboard.notCoachDescription')} />
          </section>
        </NewLookPage>
      </>
    );
  }
  const me = claims?.sub ?? '';
  const teaches = isInstructor || !isBranchStaff;

  return (
    <>
      <NewLookPageHeader title={t('coach.dashboard.title')} subtitle={school.data?.name} />
      <CoachBody schoolId={schoolId} me={me} teaches={teaches} isBranchStaff={isBranchStaff} isStudentHere={isStudentHere} />
    </>
  );
}

function CoachBody({ schoolId, me, teaches, isBranchStaff, isStudentHere }: { schoolId: string; me: string; teaches: boolean; isBranchStaff: boolean; isStudentHere: boolean }) {
  const t = useT();
  const graded = useGradedStyles(schoolId);
  // The Ready to grade list is in the panel whenever this person grades a
  // style, so the Notifications card leaves those alerts out (DESIGN.md →
  // "Coach view: nothing shown twice").
  const readyInPanel = graded.styles.length > 0;
  const upcoming = useMyUpcomingClasses(schoolId, me);
  const next = teaches ? (upcoming.data?.items ?? [])[0] : undefined;
  const showPanel = readyInPanel || !!next;
  const body = (
    <div className="u8n-dash u8n-coach">
      <div className="u8n-dash__lists">
        <GradingSection schoolId={schoolId} graded={graded} />
        {teaches ? <ClassesSection schoolId={schoolId} me={me} /> : null}
        {isBranchStaff ? <BranchClassesSection schoolId={schoolId} /> : null}
        <NotificationsSection leaveOutReady={readyInPanel} />
        {/* Decision 374 (Decision 318 item 2): every member of staff sees this week's birthdays. */}
        <BirthdaysCard schoolId={schoolId} linkToStudent={false} />
        {isStudentHere ? <MyTrainingSection schoolId={schoolId} me={me} /> : null}
      </div>
    </div>
  );
  if (!showPanel) return <NewLookPage>{body}</NewLookPage>;
  return (
    <NewLookPage inspectorLabel={next ? t('coach.dashboard.nextClass') : t('coach.dashboard.readyToGrade')} inspector={<CoachPanel schoolId={schoolId} next={next} styles={readyInPanel ? graded.styles : null} />}>
      {body}
    </NewLookPage>
  );
}

function GradingSection({ schoolId, graded }: { schoolId: string; graded: ReturnType<typeof useGradedStyles> }) {
  const t = useT();
  const { styles } = graded;
  return (
    <DashCard
      icon="grading"
      title={t('coach.dashboard.grading')}
      action={
        styles.length > 0 ? (
          <Link to="/grading" className="u8n-coach__go">
            {t('coach.dashboard.openBoard')}
          </Link>
        ) : undefined
      }
    >
      {graded.isLoading ? (
        <div className="u8n-dash__row">
          <Spinner />
        </div>
      ) : graded.error ? (
        <div className="u8n-dash__row">
          <ErrorBanner message={errorText(graded.error, t('coach.dashboard.gradingLoadFailed'))} />
        </div>
      ) : styles.length === 0 ? (
        <Empty title={t('coach.dashboard.noStylesTitle')} description={t('coach.dashboard.noStylesDescription')} />
      ) : (
        <ul className="u8n-dash__rows">
          {styles.map((style) => (
            <StyleSummary key={style.id} schoolId={schoolId} style={style} />
          ))}
        </ul>
      )}
    </DashCard>
  );
}

function StyleSummary({ schoolId, style }: { schoolId: string; style: DisciplineResponse }) {
  const t = useT();
  const board = useGradingBoard(schoolId, style.id, false);
  const items = board.data?.items ?? [];
  const ready = items.filter((i) => i.eligibility.boardColumn === 'READY_TO_GRADE').length;
  const gettingThere = items.filter((i) => i.eligibility.boardColumn === 'GETTING_THERE').length;
  return (
    <li className="u8n-dash__row u8n-coach__style">
      <span className="u8n-coach__style-name">{style.name}</span>
      {board.isLoading ? (
        <Spinner />
      ) : board.error ? (
        <span className="u8n-dash__row-sub">{errorText(board.error, t('coach.dashboard.boardLoadFailed'))}</span>
      ) : (
        <>
          <span className={'u8n-coach__tag ' + (ready > 0 ? 'u8n-coach__tag--ok' : 'u8n-coach__tag--mute')}>{t('coach.dashboard.readyCount', { count: ready })}</span>
          <span className="u8n-coach__tag u8n-coach__tag--mute">{t('coach.dashboard.gettingThereCount', { count: gettingThere })}</span>
          <span className="u8n-dash__row-sub">{t('coach.dashboard.studentsCount', { count: items.length })}</span>
        </>
      )}
    </li>
  );
}

/** Classes and weekly timetable slots where they are the instructor. The
 * soonest class is the panel's Next class, so Coming up starts after it. */
function ClassesSection({ schoolId, me }: { schoolId: string; me: string }) {
  const t = useT();
  const classes = useMyUpcomingClasses(schoolId, me);
  const slots = useTimetableSlots(schoolId);
  const weekly = useMemo(
    () =>
      (slots.data?.items ?? [])
        // Coaches review CP2: the list holds archived slots too (the owner's
        // timetable shows them on request); they are not taught any more.
        .filter((s: TimetableSlotResponse) => s.instructorId === me && s.status === 'ON' && !s.archivedAt)
        .sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.startTime.localeCompare(b.startTime)),
    [slots.data, me],
  );
  const all: ClassResponse[] = classes.data?.items ?? [];
  const upcoming = all.slice(1);
  const loading = classes.isLoading || slots.isLoading;
  const error = classes.error ?? slots.error;
  // Only the panel's Next class: this card has nothing of its own to show.
  if (!loading && !error && weekly.length === 0 && upcoming.length === 0 && all.length > 0) return null;
  return (
    <DashCard icon="schedule" title={t('coach.dashboard.myClasses')}>
      {loading ? (
        <div className="u8n-dash__row">
          <Spinner />
        </div>
      ) : error ? (
        <div className="u8n-dash__row">
          <ErrorBanner message={errorText(error, t('coach.dashboard.classesLoadFailed'))} />
        </div>
      ) : weekly.length === 0 && upcoming.length === 0 ? (
        <Empty title={t('coach.dashboard.noClassesTitle')} description={t('coach.dashboard.noClassesDescription')} />
      ) : (
        <div className="u8n-coach__classes">
          {weekly.length > 0 ? (
            <>
              <h3 className="u8n-coach__sub">{t('coach.dashboard.everyWeek')}</h3>
              <ul className="u8n-coach__lines">
                {weekly.map((s) => (
                  <li key={s.id} className="u8n-coach__line">
                    {t(WEEKDAY_LABELS[s.weekday])} {s.startTime}–{s.endTime} · {s.title}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {upcoming.length > 0 ? (
            <>
              <h3 className="u8n-coach__sub">{t('coach.dashboard.comingUp')}</h3>
              <ClassList schoolId={schoolId} classes={upcoming} links />
            </>
          ) : null}
        </div>
      )}
    </DashCard>
  );
}

/**
 * Decision 425 (Q1): a Branch Staff member's dashboard shows the classes at
 * their branch this week (and the School-wide ones, as the Classes page
 * does), with roll call and QR links when the owner lets them handle
 * bookings.
 */
function BranchClassesSection({ schoolId }: { schoolId: string }) {
  const t = useT();
  const [range] = React.useState(() => {
    const now = Date.now();
    return { to: new Date(now + WEEK_MS).toISOString() };
  });
  const classes = useClasses(schoolId, { when: 'upcoming', startsTo: range.to, limit: 50 });
  const access = useMyStaffAccess(schoolId);
  const items: ClassResponse[] = classes.data?.items ?? [];
  return (
    <DashCard icon="schedule" title={t('coach.dashboard.branchClasses')}>
      {classes.isLoading || access.isLoading ? (
        <div className="u8n-dash__row">
          <Spinner />
        </div>
      ) : classes.error ? (
        <div className="u8n-dash__row">
          <ErrorBanner message={errorText(classes.error, t('coach.dashboard.classesLoadFailed'))} />
        </div>
      ) : items.length === 0 ? (
        <Empty title={t('coach.dashboard.noBranchClassesTitle')} description={t('coach.dashboard.noBranchClassesDescription')} />
      ) : (
        <div className="u8n-coach__classes">
          <ClassList schoolId={schoolId} classes={items} links={!!access.data?.access.bookings} />
        </div>
      )}
    </DashCard>
  );
}

/** Where a class is: its branch (Decision 425 Q4), "Whole School" only for a
 * class with no branch. A branch the coach can't see is left out rather than
 * guessed, as in the app. */
function useClassPlace(schoolId: string) {
  const t = useT();
  const school = useSchool(schoolId);
  const branches = useBranches(schoolId).data?.items ?? [];
  return (c: ClassResponse) => {
    const branch = c.branchId ? branches.find((b) => b.id === c.branchId) : undefined;
    return {
      where: c.branchId ? branch?.name : t('coach.dashboard.wholeSchool'),
      zone: classZone(branch?.timezone, school.data?.timezone),
    };
  };
}

/** One line per class: day and start time on the class's own clock, title,
 * branch, then roll call and QR links, or Cancelled. */
function ClassList({ schoolId, classes, links }: { schoolId: string; classes: ClassResponse[]; links: boolean }) {
  const t = useT();
  const place = useClassPlace(schoolId);
  return (
    <ul className="u8n-coach__lines">
      {classes.map((c) => {
        const { where, zone } = place(c);
        return (
          <li key={c.id} className="u8n-coach__line u8n-coach__class">
            <span className="u8n-coach__class-text">
              {formatInZone(c.startDate, zone, formatLocale())} · {c.title}
              {where ? ` · ${where}` : null}
            </span>
            {c.cancelledAt ? (
              // Coaches review CP3: still listed, so the coach knows not to
              // come, but with no roll call or QR code to open.
              <span className="u8n-coach__tag u8n-coach__tag--bad">{t('classes.cancelled')}</span>
            ) : links ? (
              // Classes review C4: a coach had no way to reach these.
              <span className="u8n-coach__class-links">
                <Link to={`/classes/${c.id}/roll-call`}>{t('coach.dashboard.rollCall')}</Link>
                <Link to={`/classes/${c.id}/qr-code`}>{t('coach.dashboard.showQr')}</Link>
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function NotificationsSection({ leaveOutReady }: { leaveOutReady: boolean }) {
  const { t, serverText } = useI18n();
  const notifications = useNotifications();
  const items = (notifications.data?.items ?? [])
    // The Ready to grade list in the panel is the one place for ready students.
    .filter((n) => !leaveOutReady || n.type !== 'GRADING_READY')
    .slice(0, 5)
    .map((n) => ({ ...n, ...serverText.notification(n) }));
  // Every page, snoozed left out — not just the five-row preview's page.
  const unread = useNotificationCounts().data?.unread ?? 0;
  return (
    <DashCard
      icon="notifications"
      title={t('coach.dashboard.notifications')}
      action={
        <Link to="/notifications" className="u8n-dash__more">
          {unread > 0 ? t('coach.dashboard.seeAllUnread', { count: unread }) : t('coach.dashboard.seeAll')}
        </Link>
      }
    >
      {leaveOutReady ? <p className="u8n-coach__note">{t('coach.dashboard.readyNote')}</p> : null}
      {notifications.isLoading ? (
        <div className="u8n-dash__row">
          <Spinner />
        </div>
      ) : notifications.error ? (
        <div className="u8n-dash__row">
          <ErrorBanner message={errorText(notifications.error, t('coach.dashboard.notificationsLoadFailed'))} />
        </div>
      ) : items.length === 0 ? (
        <p className="u8n-dash__empty">{t('coach.dashboard.noNotifications')}</p>
      ) : (
        <ul className="u8n-dash__rows">
          {items.map((n) => {
            const to = notificationLink(n);
            return (
              <li key={n.id} className="u8n-coach__note-row" data-read={n.read}>
                <span className={'u8n-dash-notes__dot' + (n.read ? '' : ' u8n-dash-notes__dot--unread')} aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  {/* Decision 355: opens what the notification is about. */}
                  <div className="u8n-dash-notes__title">{to ? <Link to={to}>{n.title}</Link> : n.title}</div>
                  {n.body ? <div className="u8n-dash-notes__body">{n.body}</div> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashCard>
  );
}

/** Their own ranks, when they also train at this School (Decision 184: a
 * coach keeps their student side). */
function MyTrainingSection({ schoolId, me }: { schoolId: string; me: string }) {
  const t = useT();
  const eligibility = useStudentEligibility(me, schoolId);
  const disciplines = useDisciplines(schoolId);
  const items = eligibility.data?.items ?? [];
  return (
    <DashCard icon="grading" title={t('coach.dashboard.myTraining')}>
      {eligibility.isLoading || disciplines.isLoading ? (
        <div className="u8n-dash__row">
          <Spinner />
        </div>
      ) : eligibility.error ? (
        <div className="u8n-dash__row">
          <ErrorBanner message={errorText(eligibility.error, t('coach.dashboard.ranksLoadFailed'))} />
        </div>
      ) : items.length === 0 ? (
        <Empty title={t('coach.dashboard.noRankTitle')} description={t('coach.dashboard.noRankDescription')} />
      ) : (
        <ul className="u8n-dash__rows">
          {items.map((item) => (
            <MyRank key={item.disciplineId} item={item} styleName={disciplines.data?.items.find((d) => d.id === item.disciplineId)?.name ?? t('coach.dashboard.styleFallback')} />
          ))}
        </ul>
      )}
    </DashCard>
  );
}

function MyRank({ item, styleName }: { item: StudentEligibility; styleName: string }) {
  const t = useT();
  const ranks = useRanks(item.disciplineId);
  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const rung = ladder.find((r) => r.id === item.currentStripeId) ?? null;
  const e = item.eligibility;
  return (
    <li className="u8n-dash__row u8n-coach__style">
      <span className="u8n-coach__style-name u8n-coach__style-name--own">{styleName}</span>
      {rung ? <BeltChip rung={rung} /> : null}
      <span>{rung?.name ?? '—'}</span>
      {e?.hasNext ? <span className="u8n-dash__row-sub">{t('coach.dashboard.toNextRank', { percent: e.progressPercent ?? 0 })}</span> : null}
      {e?.hasNext && e.eligible ? <span className="u8n-coach__tag u8n-coach__tag--ok">{t('coach.dashboard.readyToGrade')}</span> : null}
    </li>
  );
}

/**
 * The right panel: the coach's next class (with its roll call and QR code),
 * then the Ready to grade list across the styles they grade, which is the one
 * place for ready students. Each student opens their page's Ranks tab at
 * that style (Decision 457: links from grading surfaces open Ranks).
 */
function CoachPanel({ schoolId, next, styles }: { schoolId: string; next: ClassResponse | undefined; styles: DisciplineResponse[] | null }) {
  const t = useT();
  return (
    <div className="u8n-coach-panel">
      {next ? <NextClass schoolId={schoolId} c={next} /> : null}
      {styles ? (
        <>
          {next ? (
            <p className="u8n-inspector__label u8n-coach-panel__label" id="coach-ready-label">
              {t('coach.dashboard.readyToGrade')}
            </p>
          ) : null}
          <ReadyList schoolId={schoolId} styles={styles} labelled={next ? 'coach-ready-label' : undefined} />
        </>
      ) : null}
    </div>
  );
}

function NextClass({ schoolId, c }: { schoolId: string; c: ClassResponse }) {
  const t = useT();
  const { where, zone } = useClassPlace(schoolId)(c);
  return (
    <section className="u8n-coach-panel__next" aria-label={t('coach.dashboard.nextClass')}>
      <div className="u8n-coach-panel__head">
        {c.bannerUrl ? <img src={c.bannerUrl} alt="" className="u8n-coach-panel__banner" /> : <ClassAvatar id={c.id} title={c.title} large />}
        <div style={{ minWidth: 0 }}>
          <div className="u8n-coach-panel__name">{c.title}</div>
          <div className="u8n-coach-panel__when">
            {formatInZone(c.startDate, zone, formatLocale())}–{formatTimeInZone(c.endDate, zone, formatLocale())}
            {where ? ` · ${where}` : null}
          </div>
          {c.cancelledAt ? <span className="u8n-coach__tag u8n-coach__tag--bad">{t('classes.cancelled')}</span> : null}
        </div>
      </div>
      {!c.cancelledAt ? (
        <div className="u8n-coach-panel__pair">
          <Link to={`/classes/${c.id}/roll-call`} className="ultm8-btn ultm8-btn--secondary">
            {t('coach.dashboard.rollCall')}
          </Link>
          <Link to={`/classes/${c.id}/qr-code`} className="ultm8-btn ultm8-btn--secondary">
            {t('coach.dashboard.showQr')}
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function ReadyList({ schoolId, styles, labelled }: { schoolId: string; styles: DisciplineResponse[]; labelled?: string }) {
  const t = useT();
  const boards = useQueries({ queries: styles.map((s) => gradingBoardQuery(schoolId, s.id, false)) });
  const ladders = useQueries({ queries: styles.map((s) => ranksQuery(s.id)) });
  if (boards.some((b) => b.isLoading)) return <Spinner />;
  const failed = boards.find((b) => b.error);
  if (failed) return <ErrorBanner message={errorText(failed.error, t('coach.dashboard.boardLoadFailed'))} />;
  const rows = styles.flatMap((style, i) => {
    const ladder = flattenLadder((ladders[i].data as { items: RankResponse[] } | undefined)?.items ?? []);
    return ((boards[i].data as GradingBoard | undefined)?.items ?? [])
      .filter((item) => item.eligibility.boardColumn === 'READY_TO_GRADE')
      .map((item) => ({
        item,
        style,
        from: ladder.find((r) => r.id === item.currentStripeId)?.name,
        to: ladder.find((r) => r.id === item.eligibility.nextRungId)?.name,
      }));
  });
  if (rows.length === 0) return <p className="u8n-coach-panel__empty">{t('coach.dashboard.noneReady')}</p>;
  return (
    <ul className="u8n-coach-panel__ready" aria-labelledby={labelled} aria-label={labelled ? undefined : t('coach.dashboard.readyToGrade')}>
      {rows.map(({ item, style, from, to }) => (
        <li key={`${style.id}-${item.studentId}`}>
          <Link to={{ pathname: `/students/${item.studentId}`, search: '?tab=ranks', hash: `#grading-${style.id}` }} className="u8n-coach-panel__person">
            <Avatar firstName={item.firstName} surname={item.surname} photoUrl={item.photoUrl} size={40} color="var(--u8n-coach-av-bg)" textColor="var(--u8n-coach-av-text)" />
            <span className="u8n-coach-panel__person-main">
              <span className="u8n-coach-panel__person-name">
                {item.firstName} {item.surname}
              </span>
              {from && to ? (
                <span className="u8n-dash__row-sub">
                  {from} → {to}
                </span>
              ) : null}
            </span>
            <span aria-hidden="true" className="u8n-coach-panel__chev">
              ›
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
