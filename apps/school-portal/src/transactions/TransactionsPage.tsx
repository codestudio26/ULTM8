import React from 'react';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useMembershipPlans } from '../membershipPlans/membershipPlanQueries';
import { formatMoney } from '../lib/money';
import { paymentStatusBadge } from '../lib/paymentStatusBadge';
import { useTransactions, type TransactionResponse } from './transactionQueries';

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

  return (
    <>
      <PageHeader title="Transactions" subtitle="Every completed or attempted charge against your School's Membership Plans." />
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
                // No "look up a User's name by id" endpoint exists yet (same
                // gap InstructorFormModal's own header comment already flags
                // for the identical problem) — shows the raw id, truncated.
                render: (t) => t.studentId.slice(0, 8),
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
