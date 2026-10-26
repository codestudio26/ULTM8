import React, { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, Modal, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { formatMoney } from '../lib/money';
import { paymentStatusBadge } from '../lib/paymentStatusBadge';
import {
  useSettleTransaction,
  useTransactionReceiptUrl,
  useTransactions,
  useTransactionSummary,
  type TransactionResponse,
} from './transactionQueries';
import { useT } from '../i18n/I18nProvider';
import { PAYMENT_METHOD_LABELS } from '../lib/enumLabels';
import { formatLocale } from '../i18n/format';

/** One "Receipt" cell — a drill-down from the table, not a bulk action, so it's
 * its own small component (one `useTransactionReceiptUrl()` call per row)
 * rather than a single mutation shared across the whole table. Only card rows
 * get one (Decision 335, T7): Cash/Bank Transfer has no receipt to show. `null`
 * (Stripe has no receipt yet) shows an inline message instead of silently doing
 * nothing. Opens in a new tab (`window.open`) rather than navigating away from
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

type SettleAction = 'confirm' | 'cancel';

/** "Mark as paid" / "Cancel" for one Pending Cash/Bank Transfer payment
 * (Decision 335, G1). Asks first, naming the Student, plan and amount, since
 * marking it paid creates their Membership and neither can be undone here. */
function SettleDialog({
  row,
  action,
  schoolId,
  onClose,
}: {
  row: TransactionResponse;
  action: SettleAction;
  schoolId: string;
  onClose: () => void;
}) {
  const t = useT();
  const settle = useSettleTransaction(schoolId);
  const [error, setError] = useState<string | null>(null);
  const vars = { student: studentName(row), plan: row.membershipPlanTitle, amount: formatMoney(row.amount, row.currency) };

  async function handleConfirm() {
    setError(null);
    try {
      await settle.mutateAsync({ id: row.id, action });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('transactions.settleFailed'));
    }
  }

  return (
    <Modal title={t(action === 'confirm' ? 'transactions.markPaidTitle' : 'transactions.cancelTitle')} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ margin: '0 0 16px' }}>{t(action === 'confirm' ? 'transactions.markPaidBody' : 'transactions.cancelBody', vars)}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>
          {t('transactions.back')}
        </Button>
        <Button variant={action === 'cancel' ? 'danger' : 'primary'} loading={settle.isPending} onClick={handleConfirm}>
          {t(action === 'confirm' ? 'transactions.markPaid' : 'transactions.cancelPayment')}
        </Button>
      </div>
    </Modal>
  );
}

function studentName(row: TransactionResponse): string {
  // studentFirstName/studentSurname are joined server-side (TransactionsService.findAllForSchool).
  return row.studentFirstName || row.studentSurname ? `${row.studentFirstName} ${row.studentSurname}`.trim() : row.studentId.slice(0, 8);
}

/** The School's payment ledger, newest first, a page at a time (Decision 335).
 * The tiles count the whole ledger on the server, not the page on screen.
 * Pending Cash/Bank Transfer rows can be marked paid or cancelled. */
export function TransactionsPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const { data, isLoading, error } = useTransactions(schoolId, cursorStack[pageIndex]);
  const { data: summary } = useTransactionSummary(schoolId);
  const [settling, setSettling] = useState<{ row: TransactionResponse; action: SettleAction } | null>(null);
  // Back to page 1 when the owner switches School.
  useEffect(() => {
    setCursorStack([null]);
    setPageIndex(0);
  }, [schoolId]);

  // Branch Staff and Instructors: the menu hides this page, but the address
  // still works — say why it's empty rather than showing a blank page (T5).
  if (!schoolId) return <EmptyState title={t('transactions.ownerOnlyTitle')} description={t('transactions.ownerOnlyDescription')} />;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('transactions.loadFailed')} />;

  const transactions = data?.items ?? [];
  const revenueLabel = (summary?.revenue ?? []).map((r) => formatMoney(r.amount, r.currency ?? null)).join(' + ');

  function goToNextPage(nextCursor: string | null) {
    setCursorStack((stack) => [...stack.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
  }

  return (
    <>
      <PageHeader title={t('transactions.title')} subtitle={t('transactions.subtitle')} />

      {/* Stats ribbon — counted over the whole ledger by
          GET /schools/:id/transactions/summary (Decision 335, T1). */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label={t('transactions.statTotal')} value={summary?.total ?? '—'} />
        <StatTile label={t('transactions.statSuccessful')} value={summary?.successful ?? '—'} />
        <StatTile label={t('transactions.statPending')} value={summary?.pending ?? '—'} />
        <StatTile label={t('transactions.statFailedOrDisputed')} value={summary?.failedOrDisputed ?? '—'} />
        <StatTile label={t('transactions.statRevenue')} value={summary ? revenueLabel || formatMoney(0, null) : '—'} />
      </div>

      <Card>
        {transactions.length === 0 ? (
          <EmptyState title={t('transactions.emptyTitle')} description={t('transactions.emptyDescription')} />
        ) : (
          <Table<TransactionResponse>
            rows={transactions}
            columns={[
              { key: 'billingDate', header: t('transactions.columnDate'), render: (row) => new Date(row.billingDate).toLocaleString(formatLocale()) },
              // The server sends the plan's name with each row (T6).
              { key: 'plan', header: t('transactions.columnPlan'), render: (row) => row.membershipPlanTitle },
              { key: 'student', header: t('transactions.columnStudent'), render: (row) => studentName(row) },
              { key: 'amount', header: t('transactions.columnAmount'), render: (row) => formatMoney(row.amount, row.currency) },
              { key: 'status', header: t('transactions.columnStatus'), render: (row) => paymentStatusBadge(row.status) },
              { key: 'paymentMethod', header: t('transactions.columnMethod'), render: (row) => (PAYMENT_METHOD_LABELS[row.paymentMethod] ? t(PAYMENT_METHOD_LABELS[row.paymentMethod]!) : row.paymentMethod) },
              { key: 'refunded', header: t('transactions.columnRefunded'), render: (row) => (row.refundedAmount ? formatMoney(row.refundedAmount, row.currency) : '—') },
              { key: 'disputed', header: t('transactions.columnDisputed'), render: (row) => (row.disputedAmount ? formatMoney(row.disputedAmount, row.currency) : '—') },
              { key: 'receipt', header: t('transactions.columnReceipt'), render: (row) => (row.paymentMethod === 'STRIPE' ? <ReceiptCell transactionId={row.id} /> : '—') },
              {
                key: 'actions',
                header: t('transactions.columnActions'),
                render: (row) =>
                  row.status === 'PENDING' && row.paymentMethod !== 'STRIPE' ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button variant="secondary" onClick={() => setSettling({ row, action: 'confirm' })}>
                        {t('transactions.markPaid')}
                      </Button>
                      <Button variant="secondary" onClick={() => setSettling({ row, action: 'cancel' })}>
                        {t('transactions.cancelPayment')}
                      </Button>
                    </div>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        )}
      </Card>

      {transactions.length > 0 || pageIndex > 0 ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <Button variant="secondary" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => Math.max(0, i - 1))}>
            {t('transactions.prev')}
          </Button>
          <Button variant="secondary" disabled={!data?.nextCursor} onClick={() => goToNextPage(data!.nextCursor ?? null)}>
            {t('transactions.next')}
          </Button>
          <span className="ultm8-field__hint">{t('transactions.page', { page: pageIndex + 1 })}</span>
        </div>
      ) : null}

      {settling ? <SettleDialog row={settling.row} action={settling.action} schoolId={schoolId} onClose={() => setSettling(null)} /> : null}
    </>
  );
}
