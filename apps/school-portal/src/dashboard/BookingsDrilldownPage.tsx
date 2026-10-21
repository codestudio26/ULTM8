import React, { useState } from 'react';
import { Badge, Card, EmptyState, ErrorBanner, Field, PageHeader, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBookingsSummary, type BookingsSummaryDay } from './dashboardQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(formatLocale(), { weekday: 'long', month: 'short', day: 'numeric' });

/**
 * v1.2 backend backlog — Dashboard "Bookings This Week" drill-down, the "See
 * more" destination from DashboardPage's own KPI cards. A separate route/page
 * (not an in-place expand on DashboardPage) — the same "summary card -> deeper
 * dedicated page" split ClassesPage/ClassDetailPage already establish
 * elsewhere in this app, and the day-by-day breakdown has enough of its own
 * controls (an editable date range) to earn its own screen.
 *
 * No mockup exists for this layout (see DashboardPage's own header comment) —
 * laid out fresh as a day-by-day agenda list, each day further broken down by
 * the Class's raw `activities` string tags (Decision 90's bridge, NOT the
 * canonical Discipline/styles FK — BookingsSummaryResponseDto's own header
 * comment has the full account, including the multi-tag fan-out convention
 * these per-activity numbers reflect as-is: a Class tagged both Judo and BJJ
 * shows under both, each counting that one Booking once).
 */
export function BookingsDrilldownPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  // undefined until the person picks a range — the API's own current-week
  // default (BookingsService.getWeeklySummary) is what loads first, same as
  // DashboardPage's KPI cards above it, rather than this page re-deriving
  // "this week" a second time on the client.
  const [range, setRange] = useState<{ from: string; to: string } | undefined>(undefined);
  const summary = useBookingsSummary(schoolId, range);

  const displayFrom = range?.from ?? summary.data?.from ?? '';
  const displayTo = range?.to ?? summary.data?.to ?? '';

  if (!schoolId) return null;

  return (
    <>
      <PageHeader title={t('dashboard.drilldown.title')} subtitle={t('dashboard.drilldown.subtitle')} />
      <Card>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('dashboard.drilldown.from')} htmlFor="bookings-range-from">
            <TextField
              id="bookings-range-from"
              type="date"
              value={displayFrom}
              onChange={(e) => setRange({ from: e.target.value, to: displayTo || e.target.value })}
            />
          </Field>
          <Field label={t('dashboard.drilldown.to')} htmlFor="bookings-range-to">
            <TextField
              id="bookings-range-to"
              type="date"
              value={displayTo}
              onChange={(e) => setRange({ from: displayFrom || e.target.value, to: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      {summary.isLoading ? (
        <Spinner />
      ) : summary.error ? (
        <ErrorBanner message={summary.error instanceof ApiError ? summary.error.message : t('dashboard.loadFailed')} />
      ) : !summary.data || summary.data.totalBookings === 0 ? (
        <Card>
          <EmptyState title={t('dashboard.drilldown.emptyTitle')} description={t('dashboard.drilldown.emptyDescription')} />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {summary.data.days.map((day) => (
            <DayCard key={day.date} day={day} />
          ))}
        </div>
      )}
    </>
  );
}

function DayCard({ day }: { day: BookingsSummaryDay }) {
  const t = useT();
  return (
    <Card>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: day.activities.length > 0 ? 12 : 0,
        }}
      >
        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
          {dayLabel(day.date)}
        </h2>
        <span style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>
          {t('dashboard.drilldown.bookingsCount', { count: day.totalBookings, upcoming: day.upcomingBookings })}
        </span>
      </div>
      {day.activities.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {day.activities.map((a) => (
            <li key={a.activity} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Badge>{a.activity}</Badge>
              <span style={{ fontSize: 13 }}>
                {t('dashboard.drilldown.bookingsCount', { count: a.totalBookings, upcoming: a.upcomingBookings })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
