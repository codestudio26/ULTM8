import React from 'react';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useMembershipPlans } from '../membershipPlans/membershipPlanQueries';
import { formatMoney } from '../lib/money';
import { paymentStatusBadge } from '../lib/paymentStatusBadge';
import { useTransactions, type TransactionResponse } from './transactionQueries';

/** Small, page-local summary tile — see MembershipPlansPage's own StatTile for why
 * this isn't promoted to @ultm8/ui yet (only two occurrences, and this one needs no
 * `proposed`/placeholder variant at all — every stat here is real). */
function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 140,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '14px 18px',
        background: 'var(--surface-0)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {label}
      </span>
      <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

/** Read-only — see transactionQueries.ts's own header comment on why (no
 * refund/credit-restore/invoice-download endpoints exist yet this phase). */
export function TransactionsPage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useTransactions(schoolId);
  // FOUND ON REVIEW: the table had no way to identify WHICH plan a charge
  // was for — resolve it the same way every other list screen resolves a
  // related entity's display name from an already-fetched list (see
  // ClassesPage's own branch-name lookup for the precedent).
  const { data: planData } = useMembershipPlans(schoolId);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Transactions.'} />;

  const transactions = data?.items ?? [];
  const plans = planData?.items ?? [];

  const successfulTx = transactions.filter((t) => t.status === 'SUCCESSFUL');
  const failedOrDisputedCount = transactions.filter((t) => t.status === 'FAILED' || t.status === 'DISPUTED').length;
  // Grouped by currency rather than summed flat: currency is per-Transaction, not a
  // single School-wide constant (MembershipPlan.currency is nullable and School-chosen
  // per plan, see MembershipPlanFormModal's own hint), so a School with plans in more
  // than one currency shows one revenue figure per currency instead of a meaningless
  // sum-of-different-units total.
  const revenueByCurrency = new Map<string, number>();
  for (const t of successfulTx) {
    const key = t.currency ?? '';
    revenueByCurrency.set(key, (revenueByCurrency.get(key) ?? 0) + t.amount);
  }
  const revenueLabel = [...revenueByCurrency.entries()].map(([currency, amount]) => formatMoney(amount, currency || null)).join(' + ');

  return (
    <>
      <PageHeader title="Transactions" subtitle="Every completed or attempted charge against your School's Membership Plans." />

      {/* Stats ribbon (Decision — see POST-SPEC-55-DECISION-LOG.md): every tile here is
          real and client-computed from the same `transactions` list rendered below —
          Transaction already carries status and amount, so no new endpoint was needed. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Total transactions" value={transactions.length} />
        <StatTile label="Successful" value={successfulTx.length} />
        <StatTile label="Failed / disputed" value={failedOrDisputedCount} />
        <StatTile label="Total revenue" value={revenueLabel || formatMoney(0, null)} />
      </div>

      <Card>
        {transactions.length === 0 ? (
          <EmptyState title="No Transactions yet" description="Transactions appear here once Students start purchasing Membership Plans." />
        ) : (
          <Table<TransactionResponse>
            rows={transactions}
            columns={[
              { key: 'billingDate', header: 'Date', render: (t) => new Date(t.billingDate).toLocaleString() },
              {
                key: 'plan',
                header: 'Plan',
                render: (t) => plans.find((p) => p.id === t.membershipPlanId)?.title ?? t.membershipPlanId,
              },
              {
                key: 'student',
                header: 'Student',
                // studentFirstName/studentSurname are joined server-side
                // (TransactionsService.findAllForSchool). The identical
                // "no name resolution" gap still exists in ClassDetailPage,
                // InstructorFormModal, and StaffPage — not fixed here.
                render: (t) => (t.studentFirstName || t.studentSurname ? `${t.studentFirstName} ${t.studentSurname}`.trim() : t.studentId.slice(0, 8)),
              },
              { key: 'amount', header: 'Amount', render: (t) => formatMoney(t.amount, t.currency) },
              { key: 'status', header: 'Status', render: (t) => paymentStatusBadge(t.status) },
              { key: 'paymentMethod', header: 'Method', render: (t) => t.paymentMethod },
              { key: 'refunded', header: 'Refunded', render: (t) => (t.refundedAmount ? formatMoney(t.refundedAmount, t.currency) : '—') },
              { key: 'disputed', header: 'Disputed', render: (t) => (t.disputedAmount ? formatMoney(t.disputedAmount, t.currency) : '—') },
            ]}
          />
        )}
      </Card>
    </>
  );
}
