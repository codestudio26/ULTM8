import React, { useState } from 'react';
import { ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useBranches } from '../branches/branchQueries';
import { StudentsHeader } from './StudentsTabs';
import { BillingCard, BillingPage, BillingStats } from '../billing/BillingLook';
import { NewLookSelect } from '../layout/NewLookSelect';
import { FitTable, SectionStat } from './StudentsSectionLook';
import { useAttendanceAccess, useStatsBranchOptions } from './AttendancePage';
import { useGrowth, type Growth } from './growthQueries';
import { barHeights, monthLabel } from './growthChart';

/** New and cancelled students per month, side by side, as plain bars. */
function MonthlyChart({ months }: { months: Growth['months'] }) {
  const t = useT();
  const locale = formatLocale();
  // One scale for both series, so their bars compare.
  const heights = barHeights([...months.map((m) => m.newStudents), ...months.map((m) => m.cancelled)]);
  const newHeights = heights.slice(0, months.length);
  const cancelledHeights = heights.slice(months.length);
  return (
    <BillingCard title={t('students.growth.chartTitle')}>
      {/* Small charts are mint (DESIGN.md → "One accent: mint"); cancelled is calm grey. */}
      <div className="u8st-legend">
        <span>
          <span className="u8st-swatch u8st-swatch--new" aria-hidden="true" />
          {t('students.growth.legendNew')}
        </span>
        <span>
          <span className="u8st-swatch u8st-swatch--cancelled" aria-hidden="true" />
          {t('students.growth.legendCancelled')}
        </span>
      </div>
      <div className="u8st-chart-box">
      <ol data-testid="growth-chart" className="u8st-chart">
        {months.map((m, i) => (
          <li key={m.month} aria-label={t('students.growth.chartBar', { month: monthLabel(m.month, locale), new: m.newStudents, cancelled: m.cancelled })} className="u8st-chart__month">
            <div className="u8st-chart__count" aria-hidden="true">
              {m.newStudents}
              {m.cancelled ? ` / ${m.cancelled}` : ''}
            </div>
            <div className="u8st-chart__bars" aria-hidden="true">
              <div className="u8st-chart__bar u8st-swatch--new" style={{ height: `${newHeights[i]}%` }} />
              <div className="u8st-chart__bar u8st-swatch--cancelled" style={{ height: `${cancelledHeights[i]}%` }} />
            </div>
            <div className="u8st-chart__month-name" aria-hidden="true">
              {monthLabel(m.month, locale)}
            </div>
          </li>
        ))}
      </ol>
      </div>
    </BillingCard>
  );
}

/**
 * Students → Growth (backlog 5.8, Gymdesk G1–G5): Active students (the
 * Dashboard's count, Decision 317 item 5), Visitors and frozen members now;
 * new students (by join date) and cancelled Subscriptions per month; and
 * students per style. The last 12 months in the School's time zone. Seen by
 * the owner (whole School) and Branch Staff with "See attendance statistics"
 * (their own Branches' students).
 *
 * New look (Decision 453): the approved design draws no Growth screen, so the
 * page keeps its numbers, chart and table and takes the new header and tabs,
 * the new drop-down, a stat row (DESIGN.md → "Stat rows"), a mint chart and
 * white cards; the table becomes cards when it doesn't fit.
 */
export function GrowthPage() {
  const t = useT();
  const schoolId = useGradingSchoolId();
  const may = useAttendanceAccess(schoolId);
  const [branchId, setBranchId] = useState('');
  const growth = useGrowth(schoolId, branchId || undefined, may.stats);
  const branches = useBranches(may.stats ? schoolId : null);
  const branchOptions = useStatsBranchOptions(branches.data?.items ?? [], branchId, growth.data?.branchIds);

  if (!schoolId) return null;
  const number = (n: number) => n.toLocaleString(formatLocale());
  const data = growth.data;
  const current = data?.months[data.months.length - 1];
  const sum = (key: 'newStudents' | 'cancelled') => (data?.months ?? []).reduce((n, m) => n + m[key], 0);

  return (
    <BillingPage>
      <StudentsHeader subtitle={t('students.growth.subtitle')} />
      {!may.stats ? (
        <BillingCard>
          <p className="u8st-plain">{t('students.growth.noAccess')}</p>
        </BillingCard>
      ) : (
        <>
          {branchOptions.length > 1 || branchId ? (
            <div className="u8n-dd-field u8st-branch">
              <NewLookSelect
                id="growth-branch"
                label={t('students.growth.branchLabel')}
                value={branchId}
                onChange={setBranchId}
                options={[{ value: '', label: t('students.growth.allBranches') }, ...branchOptions.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </div>
          ) : null}
          {growth.isLoading ? (
            <BillingCard>
              <Spinner />
            </BillingCard>
          ) : growth.error || !data || !current ? (
            <ErrorBanner message={growth.error instanceof ApiError ? growth.error.message : t('students.growth.loadFailed')} />
          ) : (
            <>
              <BillingCard>
                <p className="u8b-note u8st-period" data-testid="growth-period">
                  {t('students.growth.period', { zone: data.timeZone })}
                </p>
                <BillingStats>
                  <SectionStat testId="growth-active" label={t('students.growth.active')} value={number(data.activeStudents)} note={t('students.growth.activeNote')} />
                  <SectionStat testId="growth-visitors" label={t('students.growth.visitors')} value={number(data.visitors)} note={t('students.growth.visitorsNote')} />
                  <SectionStat testId="growth-frozen" label={t('students.growth.frozen')} value={number(data.frozen)} note={t('students.growth.frozenNote')} />
                  <SectionStat
                    testId="growth-new"
                    label={t('students.growth.newThisMonth')}
                    value={number(current.newStudents)}
                    note={t('students.growth.newNote', { count: number(sum('newStudents')) })}
                  />
                  <SectionStat
                    testId="growth-cancelled"
                    label={t('students.growth.cancelledThisMonth')}
                    value={number(current.cancelled)}
                    note={t('students.growth.cancelledNote', { count: number(sum('cancelled')) })}
                  />
                </BillingStats>
              </BillingCard>
              <MonthlyChart months={data.months} />
              <BillingCard title={t('students.growth.programmesTitle')}>
                {data.programmes.length === 0 ? (
                  <p className="u8b-note">{t('students.growth.noProgrammes')}</p>
                ) : (
                  <FitTable
                    rows={data.programmes.map((p) => ({ ...p, id: p.disciplineId }))}
                    columns={[
                      { key: 'name', header: t('students.growth.programmeStyle'), main: true, render: (p) => p.name },
                      { key: 'students', header: t('students.growth.programmeStudents'), render: (p) => number(p.students) },
                      { key: 'new', header: t('students.growth.programmeNew'), render: (p) => number(p.newByMonth.reduce((n, v) => n + v, 0)) },
                      { key: 'thisMonth', header: t('students.growth.programmeThisMonth'), render: (p) => number(p.newByMonth[p.newByMonth.length - 1] ?? 0) },
                    ]}
                  />
                )}
              </BillingCard>
            </>
          )}
        </>
      )}
    </BillingPage>
  );
}
