import React, { useState } from 'react';
import { Card, ErrorBanner, Field, PageHeader, SelectField, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useBranches } from '../branches/branchQueries';
import { StudentsTabs } from './StudentsTabs';
import { useAttendanceAccess } from './AttendancePage';
import { useGrowth, type Growth } from './growthQueries';
import { barHeights, monthLabel } from './growthChart';

const muted = { fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)' } as const;
const NEW_COLOUR = 'var(--fill-accent, #2563eb)';
const CANCELLED_COLOUR = 'var(--text-muted, #9ca3af)';

function Tile({ label, value, note, testId }: { label: string; value: string; note?: string; testId: string }) {
  return (
    <Card>
      <div style={{ ...muted, marginBottom: 4 }}>{label}</div>
      <div data-testid={testId} style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>
        {value}
      </div>
      {note ? <div style={{ ...muted, marginTop: 4 }}>{note}</div> : null}
    </Card>
  );
}

function Swatch({ colour }: { colour: string }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: colour, marginInlineEnd: 6 }} />;
}

/** New and cancelled students per month, side by side, as plain bars. */
function MonthlyChart({ months }: { months: Growth['months'] }) {
  const t = useT();
  const locale = formatLocale();
  // One scale for both series, so their bars compare.
  const heights = barHeights([...months.map((m) => m.newStudents), ...months.map((m) => m.cancelled)]);
  const newHeights = heights.slice(0, months.length);
  const cancelledHeights = heights.slice(months.length);
  return (
    <Card>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{t('students.growth.chartTitle')}</h2>
      <div style={{ ...muted, display: 'flex', gap: 16, marginBottom: 12 }}>
        <span>
          <Swatch colour={NEW_COLOUR} />
          {t('students.growth.legendNew')}
        </span>
        <span>
          <Swatch colour={CANCELLED_COLOUR} />
          {t('students.growth.legendCancelled')}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <ol data-testid="growth-chart" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 8, alignItems: 'flex-end', minWidth: 480 }}>
          {months.map((m, i) => (
            <li
              key={m.month}
              aria-label={t('students.growth.chartBar', { month: monthLabel(m.month, locale), new: m.newStudents, cancelled: m.cancelled })}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
            >
              <div style={{ ...muted, fontSize: 12 }} aria-hidden="true">
                {m.newStudents}
                {m.cancelled ? ` / ${m.cancelled}` : ''}
              </div>
              <div aria-hidden="true" style={{ height: 120, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                <div style={{ width: '40%', height: `${newHeights[i]}%`, background: NEW_COLOUR, borderRadius: '2px 2px 0 0' }} />
                <div style={{ width: '40%', height: `${cancelledHeights[i]}%`, background: CANCELLED_COLOUR, borderRadius: '2px 2px 0 0' }} />
              </div>
              <div style={{ ...muted, fontSize: 12, whiteSpace: 'nowrap' }} aria-hidden="true">
                {monthLabel(m.month, locale)}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

/**
 * Students → Growth (backlog 5.8, Gymdesk G1–G5): Active students (the
 * Dashboard's count, Decision 317 item 5), Visitors and frozen members now;
 * new students (by join date) and cancelled Subscriptions per month; and
 * students per style. The last 12 months in the School's time zone. Seen by
 * the owner (whole School) and Branch Staff with "See attendance statistics"
 * (their own Branches' students).
 */
export function GrowthPage() {
  const t = useT();
  const schoolId = useGradingSchoolId();
  const may = useAttendanceAccess(schoolId);
  const [branchId, setBranchId] = useState('');
  const growth = useGrowth(schoolId, branchId || undefined, may.stats);
  const branches = useBranches(may.stats ? schoolId : null);

  if (!schoolId) return null;
  const number = (n: number) => n.toLocaleString(formatLocale());
  const data = growth.data;
  // Staff see only their own Branches; the API says which.
  const branchOptions = (branches.data?.items ?? []).filter((b) => !data?.branchIds || data.branchIds.includes(b.id) || b.id === branchId);
  const current = data?.months[data.months.length - 1];
  const sum = (key: 'newStudents' | 'cancelled') => (data?.months ?? []).reduce((n, m) => n + m[key], 0);

  return (
    <>
      <PageHeader title={t('students.title')} subtitle={t('students.growth.subtitle')} />
      <StudentsTabs />
      {!may.stats ? (
        <Card>
          <p style={{ margin: 0 }}>{t('students.growth.noAccess')}</p>
        </Card>
      ) : (
        <>
          {branchOptions.length > 1 || branchId ? (
            <div style={{ marginBottom: 16 }}>
              <Field label={t('students.growth.branchLabel')} htmlFor="growth-branch">
                <SelectField
                  id="growth-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  options={[{ value: '', label: t('students.growth.allBranches') }, ...branchOptions.map((b) => ({ value: b.id, label: b.name }))]}
                />
              </Field>
            </div>
          ) : null}
          {growth.isLoading ? (
            <Spinner />
          ) : growth.error || !data || !current ? (
            <ErrorBanner message={growth.error instanceof ApiError ? growth.error.message : t('students.growth.loadFailed')} />
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              <p className="ultm8-field__hint" style={{ margin: 0 }} data-testid="growth-period">
                {t('students.growth.period', { zone: data.timeZone })}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                <Tile testId="growth-active" label={t('students.growth.active')} value={number(data.activeStudents)} note={t('students.growth.activeNote')} />
                <Tile testId="growth-visitors" label={t('students.growth.visitors')} value={number(data.visitors)} note={t('students.growth.visitorsNote')} />
                <Tile testId="growth-frozen" label={t('students.growth.frozen')} value={number(data.frozen)} note={t('students.growth.frozenNote')} />
                <Tile
                  testId="growth-new"
                  label={t('students.growth.newThisMonth')}
                  value={number(current.newStudents)}
                  note={t('students.growth.newNote', { count: number(sum('newStudents')) })}
                />
                <Tile
                  testId="growth-cancelled"
                  label={t('students.growth.cancelledThisMonth')}
                  value={number(current.cancelled)}
                  note={t('students.growth.cancelledNote', { count: number(sum('cancelled')) })}
                />
              </div>
              <MonthlyChart months={data.months} />
              <Card>
                <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{t('students.growth.programmesTitle')}</h2>
                {data.programmes.length === 0 ? (
                  <p style={{ margin: 0, ...muted }}>{t('students.growth.noProgrammes')}</p>
                ) : (
                  <Table
                    rows={data.programmes.map((p) => ({ ...p, id: p.disciplineId }))}
                    columns={[
                      { key: 'name', header: t('students.growth.programmeStyle'), render: (p) => p.name },
                      { key: 'students', header: t('students.growth.programmeStudents'), render: (p) => number(p.students) },
                      { key: 'new', header: t('students.growth.programmeNew'), render: (p) => number(p.newByMonth.reduce((n, v) => n + v, 0)) },
                      { key: 'thisMonth', header: t('students.growth.programmeThisMonth'), render: (p) => number(p.newByMonth[p.newByMonth.length - 1] ?? 0) },
                    ]}
                  />
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}
