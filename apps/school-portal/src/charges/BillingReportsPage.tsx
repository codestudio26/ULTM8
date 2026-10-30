import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { formatMoney } from '../lib/money';
import { csvCell, downloadCsv } from '../transactions/transactionsCsv';
import { useChargeOverview, useMemberBalances, type ChargeOverview, type MemberBalanceRow } from './chargeQueries';

type Tab = 'overview' | 'balances';
type BalanceFilter = 'all' | 'owes' | 'overdue' | 'credit';
const PERIODS = [3, 6, 12, 24] as const;

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** "2026-10" as "Oct 2026" in the reader's language. */
function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short' });
}

function Tile({ label, hint, value, danger }: { label: string; hint: string; value: React.ReactNode; danger?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 160,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '14px 18px',
        background: 'var(--surface-0)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 700, color: danger ? 'var(--danger, #C5221F)' : 'var(--text-primary)' }}>{value}</span>
      <span className="ultm8-field__hint">{hint}</span>
    </div>
  );
}

/**
 * The billing reports (v1.3 backlog §3.6 step 4; Decision 338 item 11), next
 * to Transactions: an Overview of charges (scheduled, overdue and paid totals,
 * revenue by month) and Member balances (everyone who owes or is in credit),
 * with a CSV of the balances. The owner sees the whole School; Branch Staff
 * whose School lets them take payments (Decision 347) see their own
 * branches' students.
 */
export function BillingReportsPage() {
  const t = useT();
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  const schoolId = ownedSchoolId ?? coachSchoolId;
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <>
      <PageHeader title={t('charges.reports.title')} subtitle={t('charges.reports.subtitle')} />
      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['overview', 'balances'] as const).map((id) => (
          <Button key={id} role="tab" aria-selected={tab === id} variant={tab === id ? 'primary' : 'secondary'} onClick={() => setTab(id)}>
            {id === 'overview' ? t('charges.reports.tabOverview') : t('charges.reports.tabBalances')}
          </Button>
        ))}
      </div>
      {!schoolId ? <ErrorBanner message={t('charges.reports.noAccess')} /> : tab === 'overview' ? <Overview schoolId={schoolId} /> : <Balances schoolId={schoolId} />}
    </>
  );
}

function Overview({ schoolId }: { schoolId: string }) {
  const t = useT();
  const [months, setMonths] = useState<number>(12);
  const overview = useChargeOverview(schoolId, months);
  if (overview.error) {
    return <ErrorBanner message={overview.error instanceof ApiError && overview.error.status === 403 ? t('charges.reports.noAccess') : errorText(overview.error, t('charges.reports.loadFailed'))} />;
  }
  if (overview.isLoading || !overview.data) return <Spinner />;
  const data: ChargeOverview = overview.data;
  return (
    <div data-testid="charge-overview">
      {!data.wholeSchool ? <p className="ultm8-field__hint">{t('charges.reports.branchesOnly')}</p> : null}
      <Field label={t('charges.reports.periodLabel')} htmlFor="charge-overview-months">
        <SelectField
          id="charge-overview-months"
          value={String(months)}
          onChange={(e) => setMonths(Number(e.target.value))}
          options={PERIODS.map((n) => ({ value: String(n), label: t('charges.reports.periodMonths', { count: n }) }))}
        />
      </Field>
      {data.currencies.length === 0 ? (
        <EmptyState title={t('charges.reports.emptyOverview')} description={t('charges.reports.emptyOverviewDescription')} />
      ) : (
        data.currencies.map((c) => (
          <Card key={c.currency}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <Tile label={t('charges.reports.scheduled')} hint={t('charges.reports.scheduledHint')} value={formatMoney(c.scheduled, c.currency)} />
              <Tile label={t('charges.reports.overdue')} hint={t('charges.reports.overdueHint')} value={formatMoney(c.overdue, c.currency)} danger={c.overdue > 0} />
              <Tile label={t('charges.reports.paid')} hint={t('charges.reports.paidHint', { count: data.months })} value={formatMoney(c.paid, c.currency)} />
            </div>
            <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>{t('charges.reports.revenueHeading')}</h3>
            <Table<ChargeOverview['currencies'][number]['revenueByMonth'][number] & { id: string }>
              rows={[...c.revenueByMonth].reverse().map((m) => ({ ...m, id: m.month }))}
              columns={[
                { key: 'month', header: t('charges.reports.columnMonth'), render: (m) => monthLabel(m.month) },
                { key: 'received', header: t('charges.reports.columnReceived'), render: (m) => formatMoney(m.received, c.currency) },
                { key: 'refunded', header: t('charges.reports.columnRefunded'), render: (m) => formatMoney(m.refunded, c.currency) },
                { key: 'net', header: t('charges.reports.columnNet'), render: (m) => <strong>{formatMoney(m.net, c.currency)}</strong> },
              ]}
            />
          </Card>
        ))
      )}
    </div>
  );
}

function Balances({ schoolId }: { schoolId: string }) {
  const t = useT();
  const balances = useMemberBalances(schoolId);
  const [filter, setFilter] = useState<BalanceFilter>('all');
  if (balances.error) {
    return <ErrorBanner message={balances.error instanceof ApiError && balances.error.status === 403 ? t('charges.reports.noAccess') : errorText(balances.error, t('charges.reports.loadFailed'))} />;
  }
  if (balances.isLoading || !balances.data) return <Spinner />;
  const rows = balances.data.items.map((r) => ({ ...r, id: `${r.studentId}:${r.currency}` })).filter((r) => filter === 'all' || (filter === 'owes' ? r.net > 0 : filter === 'overdue' ? r.overdue > 0 : r.net < 0));
  const name = (r: MemberBalanceRow) => `${r.firstName} ${r.surname}`.trim();

  function exportCsv() {
    const money = (minor: number) => (minor / 100).toFixed(2);
    const header = [t('charges.reports.columnMember'), t('charges.reports.columnOwes'), t('charges.reports.columnOverdue'), t('charges.reports.columnCredit'), t('charges.reports.columnBalance'), t('charges.reports.columnCurrency')];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) lines.push([name(r), money(r.owed), money(r.overdue), money(r.credit), money(r.net), r.currency].map(csvCell).join(','));
    // A byte-order mark so Excel opens accented names correctly, as the Transactions CSV does.
    downloadCsv(`member-balances-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${lines.join('\r\n')}\r\n`);
  }

  return (
    <div data-testid="member-balances">
      {!balances.data.wholeSchool ? <p className="ultm8-field__hint">{t('charges.reports.branchesOnly')}</p> : null}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label={t('charges.reports.filterLabel')} htmlFor="member-balances-filter">
          <SelectField
            id="member-balances-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as BalanceFilter)}
            options={[
              { value: 'all', label: t('charges.reports.filterAll') },
              { value: 'owes', label: t('charges.reports.filterOwes') },
              { value: 'overdue', label: t('charges.reports.filterOverdue') },
              { value: 'credit', label: t('charges.reports.filterCredit') },
            ]}
          />
        </Field>
        <div style={{ marginBottom: 16 }}>
          <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
            {t('charges.reports.exportCsv')}
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t('charges.reports.emptyBalances')} description={t('charges.reports.emptyBalancesDescription')} />
      ) : (
        <Table<MemberBalanceRow & { id: string }>
          rows={rows}
          columns={[
            { key: 'member', header: t('charges.reports.columnMember'), render: (r) => <Link to={`/students/${r.studentId}`}>{name(r)}</Link> },
            { key: 'owes', header: t('charges.reports.columnOwes'), render: (r) => (r.owed > 0 ? formatMoney(r.owed, r.currency) : '') },
            {
              key: 'overdue',
              header: t('charges.reports.columnOverdue'),
              render: (r) => (r.overdue > 0 ? <span style={{ color: 'var(--danger, #C5221F)', fontWeight: 600 }}>{formatMoney(r.overdue, r.currency)}</span> : ''),
            },
            { key: 'credit', header: t('charges.reports.columnCredit'), render: (r) => (r.credit > 0 ? formatMoney(r.credit, r.currency) : '') },
            {
              key: 'balance',
              header: t('charges.reports.columnBalance'),
              render: (r) => (
                <strong>{r.net > 0 ? t('charges.card.owes', { amount: formatMoney(r.net, r.currency) }) : t('charges.card.inCredit', { amount: formatMoney(-r.net, r.currency) })}</strong>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
