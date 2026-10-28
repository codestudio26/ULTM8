import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorBanner, Field, PageHeader, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBookingsSummary, type BookingsSummaryClass, type BookingsSummaryDay } from './dashboardQueries';
import { BranchFilter } from './BranchFilter';
import { checkRange, formatClassTime, formatDay, MAX_RANGE_DAYS } from './dashboardDates';
import { useT } from '../i18n/I18nProvider';

/**
 * v1.2 backend backlog — Dashboard "Bookings This Week" drill-down, the "See
 * more" destination from DashboardPage's own KPI cards. A separate route/page
 * (not an in-place expand on DashboardPage) — the same "summary card -> deeper
 * dedicated page" split ClassesPage/ClassDetailPage already establish
 * elsewhere in this app, and the day-by-day breakdown has enough of its own
 * controls (an editable date range) to earn its own screen.
 *
 * Decision 367 (Dashboard review): each day lists its Classes (time, booked /
 * seats, a link to the Class) under per-Style counts; From/To and the Branch
 * live in the address so Back and a shared link keep them (D9); a range is
 * checked here first, so a half-typed year never reaches the API and a wrong
 * range gets a translated message instead of the API's English (D2, D4).
 */
export function BookingsDrilldownPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const [params, setParams] = useSearchParams();
  const branchId = params.get('branch') ?? '';
  const urlFrom = params.get('from') ?? '';
  const urlTo = params.get('to') ?? '';
  // What the date boxes show; the address (and so the query) only follows once
  // the range is a valid one.
  const [draft, setDraft] = useState({ from: urlFrom, to: urlTo });
  useEffect(() => setDraft({ from: urlFrom, to: urlTo }), [urlFrom, urlTo]);

  const hasUrlRange = !!urlFrom || !!urlTo;
  const urlRangeOk = hasUrlRange && checkRange(urlFrom, urlTo).ok;
  // undefined until a range is picked — the API's own current-week default is
  // what loads first, same as the Dashboard's cards.
  const summary = useBookingsSummary(schoolId, urlRangeOk ? { from: urlFrom, to: urlTo } : null, branchId, !hasUrlRange || urlRangeOk);

  const shownFrom = draft.from || (!hasUrlRange ? summary.data?.from ?? '' : '');
  const shownTo = draft.to || (!hasUrlRange ? summary.data?.to ?? '' : '');
  const check = checkRange(shownFrom, shownTo);

  if (!schoolId) return null;

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const pick = (from: string, to: string) => {
    setDraft({ from, to });
    if (checkRange(from, to).ok) update({ from, to });
  };

  const rangeMessage =
    check.ok || check.reason === 'typing'
      ? null
      : check.reason === 'missing'
        ? t('dashboard.drilldown.rangeMissing')
        : check.reason === 'order'
          ? t('dashboard.drilldown.rangeOrder')
          : t('dashboard.drilldown.rangeTooLong', { max: MAX_RANGE_DAYS });

  const days = summary.data?.days ?? [];
  const nothing = days.every((d) => d.totalBookings === 0 && d.cancelledBookings === 0 && d.classes.length === 0);

  return (
    <>
      <PageHeader title={t('dashboard.drilldown.title')} subtitle={t('dashboard.drilldown.subtitle')} />
      <Card>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('dashboard.drilldown.from')} htmlFor="bookings-range-from">
            <TextField id="bookings-range-from" type="date" value={shownFrom} onChange={(e) => pick(e.target.value, shownTo)} />
          </Field>
          <Field label={t('dashboard.drilldown.to')} htmlFor="bookings-range-to">
            <TextField id="bookings-range-to" type="date" value={shownTo} onChange={(e) => pick(shownFrom, e.target.value)} />
          </Field>
          <BranchFilter schoolId={schoolId} value={branchId} onChange={(id) => update({ branch: id })} />
        </div>
        {rangeMessage ? (
          <p role="alert" style={{ margin: '12px 0 0', color: 'var(--ultm8-color-danger, #b3261e)', fontSize: 13 }}>
            {rangeMessage}
          </p>
        ) : null}
      </Card>

      {hasUrlRange && !urlRangeOk ? null : summary.isLoading ? (
        <Spinner />
      ) : summary.error ? (
        <ErrorBanner message={summary.error instanceof ApiError ? summary.error.message : t('dashboard.loadFailed')} />
      ) : !summary.data || nothing ? (
        <Card>
          <EmptyState title={t('dashboard.drilldown.emptyTitle')} description={t('dashboard.drilldown.emptyDescription')} />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {days.map((day) => (
            <DayCard key={day.date} day={day} showBranch={!branchId} />
          ))}
        </div>
      )}
    </>
  );
}

function DayCard({ day, showBranch }: { day: BookingsSummaryDay; showBranch: boolean }) {
  const t = useT();
  const muted = { color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 } as const;
  const counts = [
    t('dashboard.drilldown.bookingsCount', { count: day.totalBookings }),
    t('dashboard.drilldown.upcomingCount', { count: day.upcomingBookings }),
    ...(day.cancelledBookings > 0 ? [t('dashboard.statCancelled', { count: day.cancelledBookings })] : []),
  ].join(' · ');
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
          {formatDay(day.date)}
        </h2>
        <span style={muted}>{counts}</span>
      </div>
      {day.activities.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'grid', gap: 8 }}>
          {day.activities.map((a) => (
            <li key={a.activity ?? ''} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Badge>{a.activity ?? t('dashboard.drilldown.noStyle')}</Badge>
              <span style={{ fontSize: 13 }}>
                {t('dashboard.drilldown.bookingsCount', { count: a.totalBookings })} · {t('dashboard.drilldown.upcomingCount', { count: a.upcomingBookings })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {day.classes.length > 0 ? (
        <>
          <h3 style={{ ...muted, margin: '0 0 6px', fontWeight: 600 }}>{t('dashboard.drilldown.classesHeading')}</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {day.classes.map((c) => (
              <ClassRow key={c.classId} cls={c} showBranch={showBranch} />
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

function ClassRow({ cls, showBranch }: { cls: BookingsSummaryClass; showBranch: boolean }) {
  const t = useT();
  return (
    <li style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', fontSize: 14 }}>
      <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 48 }}>{formatClassTime(cls.startDate, cls.timeZone)}</span>
      <Link to={`/classes/${cls.classId}`} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {cls.title}
      </Link>
      {showBranch && cls.branchName ? <span style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>{cls.branchName}</span> : null}
      <span style={{ fontSize: 13 }}>
        {cls.capacity != null
          ? t('dashboard.drilldown.bookedOfCapacity', { booked: cls.bookedCount, capacity: cls.capacity })
          : t('dashboard.drilldown.booked', { count: cls.bookedCount })}
        {cls.cancelledCount > 0 ? ` · ${t('dashboard.statCancelled', { count: cls.cancelledCount })}` : ''}
      </span>
      {cls.cancelled ? <Badge variant="danger">{t('dashboard.drilldown.classCancelled')}</Badge> : null}
    </li>
  );
}
