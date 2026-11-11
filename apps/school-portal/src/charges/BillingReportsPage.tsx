import { plainMoney } from '@ultm8/i18n';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, ErrorBanner, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { formatMoney } from '../lib/money';
import { csvCell, downloadCsv } from '../transactions/transactionsCsv';
import { useChargeOverview, useMemberBalances, type ChargeOverview, type MemberBalanceRow } from './chargeQueries';
import { BillingCard, BillingHead, BillingMore, BillingPage, BillingSelect, BillingStat, BillingStats } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';

type Tab = 'overview' | 'balances';
type BalanceFilter = 'all' | 'owes' | 'overdue' | 'credit';
const PERIODS = [3, 6, 12, 24] as const;

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** "2026-10" as "Oct 2026" in the reader's language. */
function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short' });
}

/**
 * The billing reports (v1.3 backlog §3.6 step 4; Decision 338 item 11), next
 * to Transactions: an Overview (charges scheduled and overdue; revenue from
 * charges, from memberships and, Decision 449 item 10, from fees, and the
 * total, Decision 414 item 3, over the
 * period and by month) and Member balances (everyone who owes or is in credit),
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
    <BillingPage>
      <BillingHead
        header={<NewLookPageHeader title={t('charges.reports.title')} subtitle={t('charges.reports.subtitle')} />}
        tabs={[
          { id: 'overview', label: t('charges.reports.tabOverview') },
          { id: 'balances', label: t('charges.reports.tabBalances') },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />
      {!schoolId ? <ErrorBanner message={t('charges.reports.noAccess')} /> : tab === 'overview' ? <Overview schoolId={schoolId} /> : <Balances schoolId={schoolId} />}
    </BillingPage>
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
  const period = (
    <BillingSelect
      id="charge-overview-months"
      label={t('charges.reports.periodLabel')}
      value={String(months)}
      onChange={(v) => setMonths(Number(v))}
      options={PERIODS.map((n) => ({ value: String(n), label: t('charges.reports.periodMonths', { count: n }) }))}
    />
  );
  return (
    <div data-testid="charge-overview" className="u8b">
      {!data.wholeSchool ? <p className="u8b-note">{t('charges.reports.branchesOnly')}</p> : null}
      {data.currencies.length === 0 ? (
        <BillingCard toolbar={period}>
          <EmptyState title={t('charges.reports.emptyOverview')} description={t('charges.reports.emptyOverviewDescription')} />
        </BillingCard>
      ) : (
        data.currencies.map((c, i) => (
          // The period applies to every currency, so it sits on the first card only.
          <BillingCard key={c.currency} flush toolbar={i === 0 ? period : undefined}>
            <BillingStats>
              <BillingStat label={t('charges.reports.scheduled')} hint={t('charges.reports.scheduledHint')} value={formatMoney(c.scheduled, c.currency)} />
              <BillingStat label={t('charges.reports.overdue')} hint={t('charges.reports.overdueHint')} value={formatMoney(c.overdue, c.currency)} danger={c.overdue > 0} />
              <BillingStat label={t('charges.reports.revenueCharges')} hint={t('charges.reports.revenueChargesHint', { count: data.months })} value={formatMoney(c.paid, c.currency)} />
              <BillingStat
                label={t('charges.reports.revenueMemberships')}
                hint={t('charges.reports.revenueMembershipsHint', { count: data.months })}
                value={formatMoney(c.memberships, c.currency)}
              />
              {/* Decision 449 item 10: late-cancellation, no-show and freeze fees as their own line, once there are any. */}
              {c.fees > 0 ? <BillingStat label={t('charges.reports.revenueFees')} hint={t('charges.reports.revenueFeesHint', { count: data.months })} value={formatMoney(c.fees, c.currency)} /> : null}
              {/* Decision 448 item 1: the card surcharge as its own line. */}
              {c.surcharges > 0 ? (
                <BillingStat label={t('charges.reports.revenueSurcharges')} hint={t('charges.reports.revenueSurchargesHint', { count: data.months })} value={formatMoney(c.surcharges, c.currency)} />
              ) : null}
              <BillingStat label={t('charges.reports.revenueTotal')} hint={t('charges.reports.revenueTotalHint', { count: data.months })} value={formatMoney(c.total, c.currency)} />
            </BillingStats>
            <h3 className="u8b-card__sub">{t('charges.reports.revenueHeading')}</h3>
            <p className="u8b-note">{t('charges.reports.revenueHint')}</p>
            <Table<ChargeOverview['currencies'][number]['revenueByMonth'][number] & { id: string }>
              rows={[...c.revenueByMonth].reverse().map((m) => ({ ...m, id: m.month }))}
              columns={[
                { key: 'month', header: t('charges.reports.columnMonth'), render: (m) => monthLabel(m.month) },
                { key: 'received', header: t('charges.reports.columnReceived'), render: (m) => formatMoney(m.received, c.currency) },
                { key: 'refunded', header: t('charges.reports.columnRefunded'), render: (m) => formatMoney(m.refunded, c.currency) },
                { key: 'net', header: t('charges.reports.columnCharges'), render: (m) => formatMoney(m.net, c.currency) },
                { key: 'memberships', header: t('charges.reports.columnMemberships'), render: (m) => formatMoney(m.memberships, c.currency) },
                ...(c.fees > 0 || c.revenueByMonth.some((m) => m.fees > 0)
                  ? [{ key: 'fees', header: t('charges.reports.columnFees'), render: (m: ChargeOverview['currencies'][number]['revenueByMonth'][number]) => formatMoney(m.fees, c.currency) }]
                  : []),
                ...(c.surcharges > 0 || c.revenueByMonth.some((m) => m.surcharges > 0)
                  ? [{ key: 'surcharges', header: t('charges.reports.columnSurcharges'), render: (m: ChargeOverview['currencies'][number]['revenueByMonth'][number]) => formatMoney(m.surcharges, c.currency) }]
                  : []),
                { key: 'total', header: t('charges.reports.columnTotal'), render: (m) => <strong>{formatMoney(m.total, c.currency)}</strong> },
              ]}
            />
          </BillingCard>
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
    // Each currency's own decimals (Decision 431, TXT-6), as the Transactions CSV.
    const header = [t('charges.reports.columnMember'), t('charges.reports.columnOwes'), t('charges.reports.columnOverdue'), t('charges.reports.columnCredit'), t('charges.reports.columnBalance'), t('charges.reports.columnCurrency')];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) lines.push([name(r), plainMoney(r.owed, r.currency), plainMoney(r.overdue, r.currency), plainMoney(r.credit, r.currency), plainMoney(r.net, r.currency), r.currency].map(csvCell).join(','));
    // A byte-order mark so Excel opens accented names correctly, as the Transactions CSV does.
    downloadCsv(`member-balances-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${lines.join('\r\n')}\r\n`);
  }

  return (
    <div data-testid="member-balances" className="u8b">
      {!balances.data.wholeSchool ? <p className="u8b-note">{t('charges.reports.branchesOnly')}</p> : null}
      <BillingCard
        flush
        toolbar={
          <>
            <BillingSelect
              id="member-balances-filter"
              label={t('charges.reports.filterLabel')}
              value={filter}
              onChange={(v) => setFilter(v as BalanceFilter)}
              options={[
                { value: 'all', label: t('charges.reports.filterAll') },
                { value: 'owes', label: t('charges.reports.filterOwes') },
                { value: 'overdue', label: t('charges.reports.filterOverdue') },
                { value: 'credit', label: t('charges.reports.filterCredit') },
              ]}
            />
            <BillingMore>
              <Button variant="secondary" className="u8b-pill" onClick={exportCsv} disabled={rows.length === 0}>
                {t('charges.reports.exportCsv')}
              </Button>
            </BillingMore>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title={t('charges.reports.emptyBalances')} description={t('charges.reports.emptyBalancesDescription')} />
        ) : (
          <Table<MemberBalanceRow & { id: string }>
            rows={rows}
            columns={[
              {
                key: 'member',
                header: t('charges.reports.columnMember'),
                render: (r) => (
                  <Link className="u8b-name" to={`/students/${r.studentId}`}>
                    {name(r)}
                  </Link>
                ),
              },
              { key: 'owes', header: t('charges.reports.columnOwes'), render: (r) => (r.owed > 0 ? formatMoney(r.owed, r.currency) : '') },
              {
                key: 'overdue',
                header: t('charges.reports.columnOverdue'),
                render: (r) => (r.overdue > 0 ? <span style={{ color: 'var(--u8b-danger)', fontWeight: 500 }}>{formatMoney(r.overdue, r.currency)}</span> : ''),
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
      </BillingCard>
    </div>
  );
}
