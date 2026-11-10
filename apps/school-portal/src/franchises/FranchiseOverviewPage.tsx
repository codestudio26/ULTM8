import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { formatMoney } from '../lib/money';
import { monthLabel } from '../students/growthChart';
import { useFranchise, useFranchiseOverview, type FranchiseOverview } from './franchiseQueries';

type Totals = FranchiseOverview['totals'];
type Revenue = Totals['revenue'][number];

const muted = { fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)' } as const;

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

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{children}</h2>;
}

/** Revenue per currency, never added across currencies. "Fees" and "Card
 * surcharges" show once there are any, as on the billing overview. */
function RevenueCard({ revenue }: { revenue: Revenue[] }) {
  const t = useT();
  const showFees = revenue.some((r) => r.fees !== 0);
  const showSurcharges = revenue.some((r) => r.surcharges !== 0);
  return (
    <Card>
      <Heading>{t('franchises.overview.revenueTitle')}</Heading>
      <p style={{ ...muted, margin: '0 0 8px' }}>{t('franchises.overview.revenueNote')}</p>
      {revenue.length === 0 ? (
        <p style={{ margin: 0, ...muted }} data-testid="overview-no-revenue">
          {t('franchises.overview.noRevenue')}
        </p>
      ) : (
        <div data-testid="overview-revenue">
          <Table<Revenue & { id: string }>
            rows={revenue.map((r) => ({ ...r, id: r.currency }))}
            columns={[
              { key: 'currency', header: t('franchises.overview.currency'), render: (r) => r.currency },
              { key: 'memberships', header: t('franchises.overview.memberships'), render: (r) => formatMoney(r.memberships, r.currency) },
              { key: 'charges', header: t('franchises.overview.charges'), render: (r) => formatMoney(r.charges, r.currency) },
              ...(showFees ? [{ key: 'fees', header: t('franchises.overview.fees'), render: (r: Revenue) => formatMoney(r.fees, r.currency) }] : []),
              ...(showSurcharges
                ? [{ key: 'surcharges', header: t('franchises.overview.surcharges'), render: (r: Revenue) => formatMoney(r.surcharges, r.currency) }]
                : []),
              { key: 'total', header: t('franchises.overview.total'), render: (r) => <strong>{formatMoney(r.total, r.currency)}</strong> },
            ]}
          />
        </div>
      )}
    </Card>
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
    <Card>
      <Heading>{t('franchises.overview.monthsTitle')}</Heading>
      <div style={{ overflowX: 'auto' }} data-testid="overview-months">
        <Table<Row>
          rows={[...totals.months].reverse().map((m) => ({ ...m, id: m.month }))}
          columns={[
            { key: 'month', header: t('franchises.overview.month'), render: (m) => monthLabel(m.month, locale) },
            { key: 'checkIns', header: t('franchises.overview.monthCheckIns'), render: (m) => number(m.checkIns) },
            { key: 'new', header: t('franchises.overview.monthNew'), render: (m) => number(m.newStudents) },
            { key: 'cancelled', header: t('franchises.overview.monthCancelled'), render: (m) => number(m.cancelled) },
            ...totals.revenue.map((r) => ({
              key: `revenue-${r.currency}`,
              header: t('franchises.overview.monthRevenue', { currency: r.currency }),
              render: (m: Row) => formatMoney(revenueFor(r.currency, m.month), r.currency),
            })),
          ]}
        />
      </div>
    </Card>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
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
  const navigate = useNavigate();
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
    <>
      <PageHeader
        title={t('franchises.overview.title', { name: franchise.data?.name ?? t('franchises.detail.fallbackTitle') })}
        subtitle={t('franchises.overview.subtitle')}
        actions={
          <Button variant="secondary" onClick={() => navigate(`/franchises/${franchiseId}`)}>
            {t('franchises.overview.back')}
          </Button>
        }
      />
      {overview.isLoading ? (
        <Spinner />
      ) : overview.error || !data ? (
        <ErrorBanner message={overview.error instanceof ApiError ? overview.error.message : t('franchises.overview.loadFailed')} />
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <p className="ultm8-field__hint" style={{ margin: 0 }} data-testid="overview-totals-only">
            {t('franchises.overview.totalsOnly')} {t('franchises.overview.period')}
          </p>
          {data.schools.length === 0 ? (
            <EmptyState title={t('franchises.overview.noSchools')} />
          ) : (
            <>
              <div style={{ maxWidth: 360 }}>
                <Field label={t('franchises.overview.scopeLabel')} htmlFor="overview-scope">
                  <SelectField
                    id="overview-scope"
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    options={[
                      { value: '', label: t('franchises.overview.allSchools') },
                      ...data.schools.map((s) => ({ value: s.schoolId, label: s.archivedAt ? `${s.name} (${t('franchises.overview.closed')})` : s.name })),
                    ]}
                  />
                </Field>
              </div>
              <Figures totals={selected ?? data.totals} />
              {selected ? null : (
                <Card>
                  <Heading>{t('franchises.overview.schoolsTitle')}</Heading>
                  <div style={{ overflowX: 'auto' }} data-testid="overview-schools">
                    <Table<FranchiseOverview['schools'][number] & { id: string }>
                      rows={data.schools.map((s) => ({ ...s, id: s.schoolId }))}
                      columns={[
                        {
                          key: 'name',
                          header: t('franchises.overview.school'),
                          render: (s) => (
                            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              {s.name}
                              {s.archivedAt ? <Badge>{t('franchises.overview.closed')}</Badge> : null}
                            </span>
                          ),
                        },
                        { key: 'active', header: t('franchises.overview.active'), render: (s) => number(s.activeStudents) },
                        { key: 'enrolled', header: t('franchises.overview.enrolled'), render: (s) => number(s.enrolledStudents) },
                        { key: 'checkIns', header: t('franchises.overview.checkIns'), render: (s) => number(s.checkInsLast30Days) },
                        {
                          key: 'revenue',
                          header: t('franchises.overview.revenueTitle'),
                          render: (s) =>
                            s.revenue.length === 0 ? t('common.none') : s.revenue.map((r) => formatMoney(r.total, r.currency)).join(' · '),
                        },
                      ]}
                    />
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
