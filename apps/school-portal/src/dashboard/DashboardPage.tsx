import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useSchool } from '../schools/schoolQueries';
import { useBookingsSummary, useDashboardOverview } from './dashboardQueries';
import { BirthdaysCard } from './BirthdaysCard';
import { SetupChecklist } from './SetupChecklist';
import { useT } from '../i18n/I18nProvider';
import { BranchFilter } from './BranchFilter';
import { formatDay } from './dashboardDates';

/**
 * v1.2 backend backlog — Dashboard "Bookings This Week" drill-down. No mockup
 * exists for this page anywhere in this repo checkout today (`Dashboard.dc.html`
 * lives only in an external design-canvas tool outside this checkout) — the
 * product owner gave explicit go-ahead to build this fresh rather than wait on
 * one; see this feature's own PR description for the layout write-up. Two real
 * KPI cards (previously unbacked placeholder copy, per the backlog doc's own
 * entry) plus a "See more" link into BookingsDrilldownPage's day-by-day,
 * per-activity-tag view — the same "summary card -> deeper dedicated page" split
 * ClassesPage/ClassDetailPage already establish elsewhere in this app, rather
 * than an in-place expand on this same screen.
 *
 * Decision 367 (Dashboard review): cancelled Bookings counted apart, an
 * Attendance card (Spec 55 §2.1), a Branch filter kept in the address, and the
 * week shown in the picked language. Decision 374: Active students, this
 * week's birthdays and the setup checklist.
 */
export function DashboardPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const { data: school } = useSchool(schoolId);
  const [params, setParams] = useSearchParams();
  const branchId = params.get('branch') ?? '';
  const summary = useBookingsSummary(schoolId, null, branchId);
  const overview = useDashboardOverview(schoolId);

  if (!schoolId) return null;

  const setBranch = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('branch', id);
    else next.delete('branch');
    setParams(next, { replace: true });
  };
  const data = summary.data;

  return (
    <>
      <PageHeader title={t('dashboard.title')} subtitle={school?.name} />
      {/* Decision 292 — the owner hasn't chosen a cancellation policy yet. */}
      {school && !school.cancellationPolicyChosenAt ? (
        <div className="ultm8-banner ultm8-banner--warning" role="status">
          <strong>{t('schools.cancellations.chooseTitle')}</strong> {t('schools.cancellations.chooseBody')}{' '}
          <Link to="/school#cancellations">{t('schools.cancellations.chooseLink')}</Link>
        </div>
      ) : null}
      {/* Decision 374 (Decision 318 item 1). */}
      {overview.data ? <SetupChecklist schoolId={schoolId} checklist={overview.data.setupChecklist} /> : null}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <BranchFilter schoolId={schoolId} value={branchId} onChange={setBranch} />
      </div>
      <section
        aria-label={t('dashboard.bookingsAria')}
        style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 16 }}
      >
        {summary.isLoading ? (
          <Spinner />
        ) : summary.error ? (
          <ErrorBanner message={summary.error instanceof ApiError ? summary.error.message : t('dashboard.loadFailed')} />
        ) : (
          <>
            {/* Decision 367 (Q1) — cancelled Bookings are counted apart. */}
            <StatCard
              label={t('dashboard.statBookingsThisWeek')}
              value={data?.totalBookings ?? 0}
              note={data && data.cancelledBookings > 0 ? t('dashboard.statCancelled', { count: data.cancelledBookings }) : undefined}
            />
            <StatCard label={t('dashboard.statUpcoming')} value={data?.upcomingBookings ?? 0} />
            {/* Decision 374 (Decision 317 item 5) — memberships aren't per Branch, so always the whole School. */}
            <StatCard
              label={t('dashboard.statActiveStudents')}
              value={overview.data?.activeStudents ?? 0}
              note={branchId ? t('dashboard.wholeSchool') : undefined}
            />
            {/* Decision 367 (Q2) — Spec 55 §2.1's Attendance card: checked in vs no-show. */}
            <Card>
              <div style={{ fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)', marginBottom: 4 }}>{t('dashboard.statAttendance')}</div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }} data-testid="attendance-present">{data?.attendedBookings ?? 0}</div>
                  <div style={{ fontSize: 13 }}>{t('dashboard.statPresent')}</div>
                </div>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }} data-testid="attendance-absent">{data?.noShowBookings ?? 0}</div>
                  <div style={{ fontSize: 13 }}>{t('dashboard.statAbsent')}</div>
                </div>
              </div>
            </Card>
          </>
        )}
      </section>
      {data ? (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <p style={{ margin: 0, color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>
              {data.from === data.to
                ? t('dashboard.forDate', { date: formatDay(data.from, { month: 'short', day: 'numeric' }) })
                : t('dashboard.dateRange', {
                    from: formatDay(data.from, { month: 'short', day: 'numeric' }),
                    to: formatDay(data.to, { month: 'short', day: 'numeric' }),
                  })}
            </p>
            <Link to={branchId ? `/bookings-drilldown?branch=${encodeURIComponent(branchId)}` : '/bookings-drilldown'}>{t('dashboard.seeMore')}</Link>
          </div>
        </Card>
      ) : null}
      <div style={{ marginTop: 16 }}>
        <BirthdaysCard schoolId={schoolId} linkToStudent />
      </div>
    </>
  );
}

function StatCard({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <Card>
      <div style={{ fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      {note ? <div style={{ fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)', marginTop: 4 }}>{note}</div> : null}
    </Card>
  );
}
