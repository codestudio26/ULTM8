import React from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useSchool } from '../schools/schoolQueries';
import { useBookingsSummary } from './dashboardQueries';

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
 */
export function DashboardPage() {
  const schoolId = useOwnedSchoolId();
  const { data: school } = useSchool(schoolId);
  const summary = useBookingsSummary(schoolId);

  if (!schoolId) return null;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={school?.name} />
      <section
        aria-label="Bookings this week"
        style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 16 }}
      >
        {summary.isLoading ? (
          <Spinner />
        ) : summary.error ? (
          <ErrorBanner message={summary.error instanceof ApiError ? summary.error.message : 'Could not load Bookings.'} />
        ) : (
          <>
            <StatCard label="Bookings this week" value={summary.data?.totalBookings ?? 0} />
            <StatCard label="Upcoming" value={summary.data?.upcomingBookings ?? 0} />
          </>
        )}
      </section>
      {summary.data ? (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <p style={{ margin: 0, color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>
              {summary.data.from === summary.data.to ? `For ${summary.data.from}.` : `${summary.data.from} – ${summary.data.to}.`}
            </p>
            <Link to="/bookings-drilldown">See more →</Link>
          </div>
        </Card>
      ) : null}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <div style={{ fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
    </Card>
  );
}
