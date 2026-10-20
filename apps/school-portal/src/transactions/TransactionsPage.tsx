import React, { useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useMembershipPlans } from '../membershipPlans/membershipPlanQueries';
import { formatMoney } from '../lib/money';
import { paymentStatusBadge } from '../lib/paymentStatusBadge';
import { useTransactionReceiptUrl, useTransactions, type TransactionResponse } from './transactionQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

/** One "Receipt" cell — a drill-down from the table, not a bulk action, so it's
 * its own small component (one `useTransactionReceiptUrl()` call per row)
 * rather than a single mutation shared across the whole table. `null`
 * (CASH/BANK_TRANSFER, or Stripe simply has no receipt yet) shows an inline
 * message instead of silently doing nothing — a real, normal state, not an
 * error. Opens in a new tab (`window.open`) rather than navigating away from
 * the Transactions table. */
function ReceiptCell({ transactionId }: { transactionId: string }) {
  const t = useT();
  const getReceiptUrl = useTransactionReceiptUrl();
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    try {
      const { receiptUrl } = await getReceiptUrl.mutateAsync(transactionId);
      if (!receiptUrl) {
        setError(t('transactions.noReceipt'));
        return;
      }
      window.open(receiptUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('transactions.receiptFailed'));
    }
  }

  return (
    <div>
      <Button variant="secondary" loading={getReceiptUrl.isPending} onClick={handleClick}>
        {t('transactions.receipt')}
      </Button>
      {error ? <div style={{ color: 'var(--text-danger)', fontSize: 12 }}>{error}</div> : null}
    </div>
  );
}

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

/** Read-only except for the "Receipt" drill-down column (`ReceiptCell` above) —
 * no refund/credit-restore endpoint exists yet this phase; see
 * transactionQueries.ts's own header comment for invoice-download, now built. */
export function TransactionsPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useTransactions(schoolId);
  // FOUND ON REVIEW: the table had no way to identify WHICH plan a charge
  // was for — resolve it the same way every other list screen resolves a
  // related entity's display name from an already-fetched list (see
  // ClassesPage's own branch-name lookup for the precedent).
  const { data: planData } = useMembershipPlans(schoolId);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('transactions.loadFailed')} />;

  const transactions = data?.items ?? [];
  const plans = planData?.items ?? [];

  const successfulTx = transactions.filter((t) => t.status === 'SUCCESSFUL');
  const failedOrDisputedCount = transactions.filter((t) => t.status === 'FAILED' || t.status === 'DISPUTED').length;
  // Grouped by currency rather than summed flat: currency is per-Transaction, not a
  // single School-wide constant (MembershipPlan.currency is nullable and School-chosen
  // per plan, see MembershipPlanFormPage's own hint), so a School with plans in more
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
      <PageHeader title={t('transactions.title')} subtitle={t('transactions.subtitle')} />

      {/* Stats ribbon (Decision — see POST-SPEC-55-DECISION-LOG.md): every tile here is
          real and client-computed from the same `transactions` list rendered below —
          Transaction already carries status and amount, so no new endpoint was needed. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label={t('transactions.statTotal')} value={transactions.length} />
        <StatTile label={t('transactions.statSuccessful')} value={successfulTx.length} />
        <StatTile label={t('transactions.statFailedOrDisputed')} value={failedOrDisputedCount} />
        <StatTile label={t('transactions.statRevenue')} value={revenueLabel || formatMoney(0, null)} />
      </div>

      <Card>
        {transactions.length === 0 ? (
          <EmptyState title={t('transactions.emptyTitle')} description={t('transactions.emptyDescription')} />
        ) : (
          <Table<TransactionResponse>
            rows={transactions}
            columns={[
              { key: 'billingDate', header: t('transactions.columnDate'), render: (t) => new Date(t.billingDate).toLocaleString(formatLocale()) },
              {
                key: 'plan',
                header: t('transactions.columnPlan'),
                render: (t) => plans.find((p) => p.id === t.membershipPlanId)?.title ?? t.membershipPlanId,
              },
              {
                key: 'student',
                header: t('transactions.columnStudent'),
                // studentFirstName/studentSurname are joined server-side
                // (TransactionsService.findAllForSchool). The identical
                // "no name resolution" gap still exists in ClassDetailPage,
                // InstructorFormModal, and StaffPage — not fixed here.
                render: (t) => (t.studentFirstName || t.studentSurname ? `${t.studentFirstName} ${t.studentSurname}`.trim() : t.studentId.slice(0, 8)),
              },
              { key: 'amount', header: t('transactions.columnAmount'), render: (t) => formatMoney(t.amount, t.currency) },
              { key: 'status', header: t('transactions.columnStatus'), render: (t) => paymentStatusBadge(t.status) },
              { key: 'paymentMethod', header: t('transactions.columnMethod'), render: (t) => t.paymentMethod },
              { key: 'refunded', header: t('transactions.columnRefunded'), render: (t) => (t.refundedAmount ? formatMoney(t.refundedAmount, t.currency) : '—') },
              { key: 'disputed', header: t('transactions.columnDisputed'), render: (t) => (t.disputedAmount ? formatMoney(t.disputedAmount, t.currency) : '—') },
              { key: 'receipt', header: t('transactions.columnReceipt'), render: (t) => <ReceiptCell transactionId={t.id} /> },
            ]}
          />
        )}
      </Card>
    </>
  );
}
