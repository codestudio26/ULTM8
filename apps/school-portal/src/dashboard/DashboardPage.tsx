import React from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useOwnedSchoolId } from '../auth/AuthContext';
import { useSchool } from '../schools/schoolQueries';
import { useBookingsSummary, useCheckInsToday, useDashboardOverview, type BookingsSummaryClass, type BookingsSummaryResponse } from './dashboardQueries';
import { BirthdaysCard } from './BirthdaysCard';
import { ReadyToGradeCard } from './ReadyToGradeCard';
import { SetupChecklist } from './SetupChecklist';
import { useI18n, useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { BranchPicker, useBranchChoices } from './BranchPicker';
import { formatClassTime, formatRange } from './dashboardDates';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { MenuIconSvg } from '../layout/newLookIcons';
import { notificationLink, useNotificationCounts, useNotifications } from '../notifications/notificationQueries';
import { DashCard } from './DashCard';
import './dashboardPage.css';

/**
 * The owner's Dashboard, in the new look (Decision 453; DESIGN-BRIEF §8 and
 * DESIGN.md → "Dashboard: nothing shown twice, cards first on a phone",
 * "Stat rows"). Layout only: the same figures as before, from the same API
 * calls.
 *
 * - v1.2 backend backlog — "Bookings This Week" with "See more" into
 *   BookingsDrilldownPage's day-by-day view.
 * - Decision 367 (Dashboard review): cancelled Bookings counted apart, the
 *   Attendance card (Spec 55 §2.1), the Branch filter kept in the address,
 *   the week shown in the picked language.
 * - Decision 374: Active students, this week's birthdays and the setup
 *   checklist.
 * - Decision 454 item 8: "Check-ins today" (a number card that follows the
 *   Branch filter) and the "Ready to grade" list, where the design draws them;
 *   Birthdays stays, under Ready to grade (Decision 454 item 5).
 * - Today's classes are this week's summary's own classes for today (each on
 *   its own clock), so they follow the Branch filter like the numbers do.
 * - The right panel, "Needs attention", is the owner's own notifications (the
 *   same inbox the bell and the Notifications page read).
 */
export function DashboardPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const knownUser = !!useAuth().claims;
  const { data: school } = useSchool(schoolId);
  const [params, setParams] = useSearchParams();
  const branchId = params.get('branch') ?? '';
  const summary = useBookingsSummary(schoolId, null, branchId);
  const overview = useDashboardOverview(schoolId);
  const checkIns = useCheckInsToday(schoolId, branchId);
  const branches = useBranchChoices(schoolId ?? '', branchId);

  // Coaches review CP5: owner-only — anyone else goes back to their own home
  // page. Not while the session can't be read yet (a token being refreshed):
  // then nobody is known to own anything, and the page waits instead.
  if (!schoolId) return knownUser ? <Navigate to="/" replace /> : null;

  const setBranch = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('branch', id);
    else next.delete('branch');
    setParams(next, { replace: true });
  };
  const data = summary.data;

  // The line under "Dashboard" says only the Branch scope; the School's name
  // is on the School switcher. Where the owner can pick a Branch, the picker
  // shows the scope instead, so it isn't said twice.
  return (
    <>
      <NewLookPageHeader
        title={t('dashboard.title')}
        subtitle={branches.offered ? undefined : t('dashboard.branchAll')}
        actions={branches.offered ? <BranchPicker options={branches.options} value={branchId} onChange={setBranch} /> : undefined}
      />
      <NewLookPage inspectorLabel={t('dashboard.needsAttention')} inspector={<NotificationsPanel />}>
        <div className="u8n-dash">
          {/* Decision 292 — the owner hasn't chosen a cancellation policy yet. */}
          {school && !school.cancellationPolicyChosenAt ? (
            <div className="ultm8-banner ultm8-banner--warning" role="status">
              <strong>{t('schools.cancellations.chooseTitle')}</strong> {t('schools.cancellations.chooseBody')}{' '}
              <Link to="/school#cancellations">{t('schools.cancellations.chooseLink')}</Link>
            </div>
          ) : null}
          {/* Decision 374 (Decision 318 item 1). */}
          {overview.data ? <SetupChecklist schoolId={schoolId} checklist={overview.data.setupChecklist} /> : null}

          <section aria-label={t('dashboard.bookingsAria')} className="u8n-dash__stats">
            {summary.isLoading ? (
              <Spinner />
            ) : summary.error ? (
              <ErrorBanner message={summary.error instanceof ApiError ? summary.error.message : t('dashboard.loadFailed')} />
            ) : (
              <>
                {/* Decision 367 (Q1) — cancelled Bookings are counted apart. */}
                <StatCard
                  testId="stat-bookings"
                  label={t('dashboard.statBookingsThisWeek')}
                  value={data?.totalBookings ?? 0}
                  notes={[
                    data ? rangeText(data) : null,
                    data && data.cancelledBookings > 0 ? t('dashboard.statCancelled', { count: data.cancelledBookings }) : null,
                  ]}
                  link={
                    <Link to={branchId ? `/bookings-drilldown?branch=${encodeURIComponent(branchId)}` : '/bookings-drilldown'} className="u8n-dash__more">
                      {t('dashboard.seeMore')}
                    </Link>
                  }
                />
                <StatCard testId="stat-upcoming" label={t('dashboard.statUpcoming')} value={data?.upcomingBookings ?? 0} />
                {/* Decision 454 item 8 — check-ins to today's classes, on the School's clock. */}
                <StatCard
                  testId="stat-checkins"
                  label={t('dashboard.statCheckInsToday')}
                  value={checkIns.data ? checkIns.data.checkIns : checkIns.error ? '–' : 0}
                  notes={[
                    checkIns.error
                      ? checkIns.error instanceof ApiError
                        ? checkIns.error.message
                        : t('dashboard.checkInsLoadFailed')
                      : checkIns.data && checkIns.data.classes > 0
                        ? t('dashboard.checkInsAcrossClasses', { count: checkIns.data.classes })
                        : null,
                  ]}
                />
                {/* Decision 374 (Decision 317 item 5) — memberships aren't per Branch, so always the whole School. */}
                <StatCard
                  testId="stat-active"
                  label={t('dashboard.statActiveStudents')}
                  value={overview.data?.activeStudents ?? 0}
                  notes={[branchId ? t('dashboard.wholeSchool') : null]}
                />
                {/* Decision 367 (Q2) — Spec 55 §2.1's Attendance card: checked in vs no-show. */}
                <div className="u8n-dash__stat" data-testid="stat-attendance">
                  <span className="u8n-dash__stat-label">{t('dashboard.statAttendance')}</span>
                  <div className="u8n-dash__stat-pair">
                    <div>
                      <span className="u8n-dash__stat-value" data-testid="attendance-present">
                        {data?.attendedBookings ?? 0}
                      </span>
                      <span className="u8n-dash__stat-note">{t('dashboard.statPresent')}</span>
                    </div>
                    <div>
                      <span className="u8n-dash__stat-value" data-testid="attendance-absent">
                        {data?.noShowBookings ?? 0}
                      </span>
                      <span className="u8n-dash__stat-note">{t('dashboard.statAbsent')}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          <div className="u8n-dash__lists">
            <TodaysClasses summary={data} loading={summary.isLoading} />
            <div className="u8n-dash__col">
              <ReadyToGradeCard schoolId={schoolId} branchPicked={!!branchId} />
              <BirthdaysCard schoolId={schoolId} linkToStudent />
            </div>
          </div>
        </div>
      </NewLookPage>
    </>
  );
}

function rangeText(data: BookingsSummaryResponse): string {
  return formatRange(data.from, data.to);
}

/** One number card (DESIGN.md → "Stat rows"); the coach dashboard's
 * "Check-ins today" uses it too (Decision 461 item 4). */
export function StatCard({ label, value, notes = [], link, testId }: { label: string; value: number | string; notes?: (string | null)[]; link?: React.ReactNode; testId: string }) {
  const shown = notes.filter((n): n is string => !!n);
  return (
    <div className="u8n-dash__stat" data-testid={testId}>
      <span className="u8n-dash__stat-label">{label}</span>
      <span className="u8n-dash__stat-value">{value}</span>
      {shown.length ? <span className="u8n-dash__stat-note">{shown.join(' · ')}</span> : null}
      {link}
    </div>
  );
}

/** Today's classes from this week's summary: a class is today when its own
 * local day (its Branch's time zone, as the API filed it) is today there. */
function todaysClasses(summary: BookingsSummaryResponse | undefined): BookingsSummaryClass[] {
  if (!summary) return [];
  const now = new Date();
  const todayIn = (zone: string) => {
    try {
      return now.toLocaleDateString('en-CA', { timeZone: zone });
    } catch {
      return now.toISOString().slice(0, 10);
    }
  };
  return summary.days
    .flatMap((d) => d.classes.filter((c) => todayIn(c.timeZone) === d.date))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function TodaysClasses({ summary, loading }: { summary: BookingsSummaryResponse | undefined; loading: boolean }) {
  const t = useT();
  const classes = todaysClasses(summary);
  return (
    <DashCard
      icon="schedule"
      title={t('dashboard.todaysClasses')}
      action={
        <Link to="/check-in" className="u8n-dash__more">
          {t('dashboard.openCheckIn')}
        </Link>
      }
    >
      {loading ? (
        <div className="u8n-dash__row">
          <Spinner />
        </div>
      ) : classes.length === 0 ? (
        <p className="u8n-dash__empty">{t('dashboard.noClassesToday')}</p>
      ) : (
        <ul className="u8n-dash__rows">
          {classes.map((c) => (
            <li key={c.classId} className="u8n-dash__row" data-testid="today-class">
              <ClassAvatar id={c.classId} title={c.title} />
              <div className="u8n-dash__row-main">
                <div className="u8n-dash__row-name">{c.title}</div>
                {c.branchName ? <div className="u8n-dash__row-sub">{c.branchName}</div> : null}
              </div>
              <div className="u8n-dash__row-end">
                <div className="u8n-dash__row-time">{formatClassTime(c.startDate, c.timeZone)}</div>
                <div className="u8n-dash__row-sub">
                  {c.cancelled
                    ? t('dashboard.drilldown.classCancelled')
                    : c.capacity !== null
                      ? t('dashboard.drilldown.bookedOfCapacity', { booked: c.bookedCount, capacity: c.capacity })
                      : t('dashboard.drilldown.booked', { count: c.bookedCount })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DashCard>
  );
}

/** DESIGN.md → "Avatars": a class with no banner is a soft-coloured circle
 * with its initials; the colour, not the shape, tells classes apart. The
 * summary carries no banner, so it is always the initials here. `large` is
 * the right panel's 64px size (the coach dashboard's Next class). */
const CLASS_TILES = ['u8n-dash__av--a', 'u8n-dash__av--b', 'u8n-dash__av--c', 'u8n-dash__av--d', 'u8n-dash__av--e'];

export function ClassAvatar({ id, title, large = false }: { id: string; title: string; large?: boolean }) {
  const words = title
    .replace(/[()]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => /^\p{L}/u.test(w));
  const letters = (words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...(words[0] ?? '?')].slice(0, 2).join('')).toLocaleUpperCase();
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={`u8n-dash__av ${CLASS_TILES[hash % CLASS_TILES.length]}${large ? ' u8n-dash__av--lg' : ''}`} aria-hidden="true">
      {letters}
    </span>
  );
}

/** "Needs attention": the owner's newest notifications, the unread count and
 * the way to the Notifications page. Each opens what it is about (Decision 355). */
function NotificationsPanel() {
  const { t, serverText } = useI18n();
  const notifications = useNotifications();
  const unread = useNotificationCounts().data?.unread ?? 0;
  const items = (notifications.data?.items ?? []).slice(0, 5).map((n) => ({ ...n, ...serverText.notification(n) }));
  return (
    <div className="u8n-dash-notes">
      <header className="u8n-dash-notes__head">
        <h2 className="u8n-dash__card-title">
          <MenuIconSvg icon="notifications" />
          {t('dashboard.notifications')}
        </h2>
        {unread > 0 ? <span className="u8n-dash-notes__count">{t('dashboard.unreadCount', { count: unread })}</span> : null}
      </header>
      {notifications.isLoading ? (
        <Spinner />
      ) : notifications.error ? (
        <ErrorBanner message={notifications.error instanceof ApiError ? notifications.error.message : t('dashboard.notificationsLoadFailed')} />
      ) : items.length === 0 ? (
        <p className="u8n-dash-notes__empty">{t('dashboard.noNotifications')}</p>
      ) : (
        <ul className="u8n-dash-notes__list">
          {items.map((n) => {
            const to = notificationLink(n);
            return (
              <li key={n.id} className="u8n-dash-notes__item" data-read={n.read}>
                <span className={'u8n-dash-notes__dot' + (n.read ? '' : ' u8n-dash-notes__dot--unread')} aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <div className="u8n-dash-notes__title">{to ? <Link to={to}>{n.title}</Link> : n.title}</div>
                  {n.body ? <div className="u8n-dash-notes__body">{n.body}</div> : null}
                  <div className="u8n-dash-notes__when">{new Date(n.createdAt).toLocaleString(formatLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/notifications" className="u8n-dash-notes__all">
        {t('dashboard.seeAllNotifications')}
      </Link>
    </div>
  );
}
