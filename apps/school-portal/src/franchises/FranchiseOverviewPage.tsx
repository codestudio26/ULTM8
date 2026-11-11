import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { formatMoney } from '../lib/money';
import { monthLabel } from '../students/growthChart';
import { useFranchise, useFranchiseOverview, type FranchiseOverview } from './franchiseQueries';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import '../students/studentsList.css';
import '../organisation/organisationLook.css';

type Totals = FranchiseOverview['totals'];
type Revenue = Totals['revenue'][number];

function Tile({ label, value, note, testId }: { label: string; value: string; note?: string; testId: string }) {
  return (
    <div className="u8o-stat">
      <span className="u8o-stat__label">{label}</span>
      <span className="u8o-stat__value" data-testid={testId}>
        {value}
      </span>
      {note ? <span className="u8o-stat__note">{note}</span> : null}
    </div>
  );
}

/** A new-look card: a light header with the title, then the body. */
function OverviewCard({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="u8o-card" aria-label={title}>
      <header className="u8o-card__head">
        <h2 className="u8o-card__title">{title}</h2>
        {note ? <p className="u8o-quiet" style={{ flex: '1 1 100%' }}>{note}</p> : null}
      </header>
      <div className="u8o-card__body u8o-card__body--flush">{children}</div>
    </section>
  );
}

/** The list card's table (studentsList.css), from column definitions. */
function OverviewTable<T extends { id: string }>({ rows, columns }: { rows: T[]; columns: Array<{ key: string; header: string; render: (row: T) => React.ReactNode; num?: boolean }> }) {
  return (
    <div className="u8n-list__scroll">
      <table className="u8n-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.num ? 'u8o-num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'u8o-num' : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Revenue per currency, never added across currencies. "Fees" and "Card
 * surcharges" show once there are any, as on the billing overview. */
function RevenueCard({ revenue }: { revenue: Revenue[] }) {
  const t = useT();
  const showFees = revenue.some((r) => r.fees !== 0);
  const showSurcharges = revenue.some((r) => r.surcharges !== 0);
  return (
    <OverviewCard title={t('franchises.overview.revenueTitle')} note={t('franchises.overview.revenueNote')}>
      {revenue.length === 0 ? (
        <p className="u8o-quiet" style={{ marginBottom: 16 }} data-testid="overview-no-revenue">
          {t('franchises.overview.noRevenue')}
        </p>
      ) : (
        <div data-testid="overview-revenue">
          <OverviewTable<Revenue & { id: string }>
            rows={revenue.map((r) => ({ ...r, id: r.currency }))}
            columns={[
              { key: 'currency', header: t('franchises.overview.currency'), render: (r) => r.currency },
              { key: 'memberships', header: t('franchises.overview.memberships'), num: true, render: (r) => formatMoney(r.memberships, r.currency) },
              { key: 'charges', header: t('franchises.overview.charges'), num: true, render: (r) => formatMoney(r.charges, r.currency) },
              ...(showFees ? [{ key: 'fees', header: t('franchises.overview.fees'), num: true, render: (r: Revenue) => formatMoney(r.fees, r.currency) }] : []),
              ...(showSurcharges
                ? [{ key: 'surcharges', header: t('franchises.overview.surcharges'), num: true, render: (r: Revenue) => formatMoney(r.surcharges, r.currency) }]
                : []),
              { key: 'total', header: t('franchises.overview.total'), num: true, render: (r) => <strong>{formatMoney(r.total, r.currency)}</strong> },
            ]}
          />
        </div>
      )}
    </OverviewCard>
  );
}

/** Check-ins, new and cancelled students, and revenue in each currency, per month. */
function MonthsCard({ totals }: { totals: Totals }) {
  const t = useT();
  const locale = formatLocale();
  const number = (n: number) => n.toLocaleString(locale);
  type Row = Totals['months'][number] & { id: string };
  const revenueFor = (currency: string, month: string) =>
    totals.revenue.find((r) => r.currency === currency)?.byMonth.find((m) => m.month === month)?.total ?? 0;
  return (
    <OverviewCard title={t('franchises.overview.monthsTitle')}>
      <div data-testid="overview-months">
        <OverviewTable<Row>
          rows={[...totals.months].reverse().map((m) => ({ ...m, id: m.month }))}
          columns={[
            { key: 'month', header: t('franchises.overview.month'), render: (m) => monthLabel(m.month, locale) },
            { key: 'checkIns', header: t('franchises.overview.monthCheckIns'), num: true, render: (m) => number(m.checkIns) },
            { key: 'new', header: t('franchises.overview.monthNew'), num: true, render: (m) => number(m.newStudents) },
            { key: 'cancelled', header: t('franchises.overview.monthCancelled'), num: true, render: (m) => number(m.cancelled) },
            ...totals.revenue.map((r) => ({
              key: `revenue-${r.currency}`,
              header: t('franchises.overview.monthRevenue', { currency: r.currency }),
              num: true,
              render: (m: Row) => formatMoney(revenueFor(r.currency, m.month), r.currency),
            })),
          ]}
        />
      </div>
    </OverviewCard>
  );
}

/** The figures for one scope: the whole Franchise or one member School. */
function Figures({ totals }: { totals: Totals }) {
  const t = useT();
  const number = (n: number) => n.toLocaleString(formatLocale());
  const current = totals.months[totals.months.length - 1];
  const sum = (key: 'newStudents' | 'cancelled') => totals.months.reduce((n, m) => n + m[key], 0);
  return (
    <>
      <div className="u8o-stats">
        <Tile testId="overview-active" label={t('franchises.overview.active')} value={number(totals.activeStudents)} note={t('franchises.overview.activeNote')} />
        <Tile testId="overview-enrolled" label={t('franchises.overview.enrolled')} value={number(totals.enrolledStudents)} note={t('franchises.overview.enrolledNote')} />
        <Tile testId="overview-check-ins" label={t('franchises.overview.checkIns')} value={number(totals.checkInsLast30Days)} note={t('franchises.overview.checkInsNote')} />
        <Tile
          testId="overview-new"
          label={t('franchises.overview.newThisMonth')}
          value={number(current?.newStudents ?? 0)}
          note={t('franchises.overview.newNote', { count: number(sum('newStudents')) })}
        />
        <Tile
          testId="overview-cancelled"
          label={t('franchises.overview.cancelledThisMonth')}
          value={number(current?.cancelled ?? 0)}
          note={t('franchises.overview.cancelledNote', { count: number(sum('cancelled')) })}
        />
      </div>
      <RevenueCard revenue={totals.revenue} />
      <MonthsCard totals={totals} />
    </>
  );
}

/**
 * Decision 450 item 1 — the Franchise owner's read-only overview of its member
 * Schools' totals: students, attendance, revenue and growth, for the whole
 * Franchise or one School. Totals only: nothing here opens a School's
 * students, classes or payments, and nothing changes anything at a School.
 * Revenue stays per currency. Only the Franchise's owner can load it (the API
 * refuses everyone else).
 */
export function FranchiseOverviewPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const franchiseId = id ?? null;
  const franchise = useFranchise(franchiseId);
  const overview = useFranchiseOverview(franchiseId);
  const [scope, setScope] = useState('');

  if (!franchiseId) return null;
  const number = (n: number) => n.toLocaleString(formatLocale());
  const data = overview.data;
  const selected = data?.schools.find((s) => s.schoolId === scope) ?? null;

  return (
    <div className="u8o">
      <NewLookPageHeader
        parent={{ to: `/franchises/${franchiseId}`, label: t('franchises.overview.back') }}
        title={t('franchises.overview.title', { name: franchise.data?.name ?? t('franchises.detail.fallbackTitle') })}
        subtitle={t('franchises.overview.subtitle')}
      />
      {overview.isLoading ? (
        <Spinner />
      ) : overview.error || !data ? (
        <ErrorBanner message={overview.error instanceof ApiError ? overview.error.message : t('franchises.overview.loadFailed')} />
      ) : (
        <>
          <p className="u8o-note" data-testid="overview-totals-only">
            {t('franchises.overview.totalsOnly')} {t('franchises.overview.period')}
          </p>
          {data.schools.length === 0 ? (
            <section className="u8o-card">
              <EmptyState title={t('franchises.overview.noSchools')} />
            </section>
          ) : (
            <>
              <NewLookSelect
                id="overview-scope"
                label={t('franchises.overview.scopeLabel')}
                value={scope}
                onChange={setScope}
                options={[
                  { value: '', label: t('franchises.overview.allSchools') },
                  ...data.schools.map((s) => ({ value: s.schoolId, label: s.archivedAt ? `${s.name} (${t('franchises.overview.closed')})` : s.name })),
                ]}
              />
              <Figures totals={selected ?? data.totals} />
              {selected ? null : (
                <OverviewCard title={t('franchises.overview.schoolsTitle')}>
                  <div data-testid="overview-schools">
                    <OverviewTable<FranchiseOverview['schools'][number] & { id: string }>
                      rows={data.schools.map((s) => ({ ...s, id: s.schoolId }))}
                      columns={[
                        {
                          key: 'name',
                          header: t('franchises.overview.school'),
                          render: (s) => (
                            <span className="u8o-row u8o-rowname" style={{ gap: 8 }}>
                              {s.name}
                              {s.archivedAt ? <span className="u8n-tag u8n-tag--inactive">{t('franchises.overview.closed')}</span> : null}
                            </span>
                          ),
                        },
                        { key: 'active', header: t('franchises.overview.active'), num: true, render: (s) => number(s.activeStudents) },
                        { key: 'enrolled', header: t('franchises.overview.enrolled'), num: true, render: (s) => number(s.enrolledStudents) },
                        { key: 'checkIns', header: t('franchises.overview.checkIns'), num: true, render: (s) => number(s.checkInsLast30Days) },
                        {
                          key: 'revenue',
                          header: t('franchises.overview.revenueTitle'),
                          num: true,
                          render: (s) =>
                            s.revenue.length === 0 ? t('common.none') : s.revenue.map((r) => formatMoney(r.total, r.currency)).join(' · '),
                        },
                      ]}
                    />
                  </div>
                </OverviewCard>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
