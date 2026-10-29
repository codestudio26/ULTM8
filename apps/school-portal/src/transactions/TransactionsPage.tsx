import React, { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, SelectField, Spinner, SuccessBanner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { formatMoney } from '../lib/money';
import { PAYMENT_STATUS_LABELS, paymentStatusBadge } from '../lib/paymentStatusBadge';
import { fetchAllPages, ALL_PAGES_LIMIT } from '../lib/fetchAllPages';
import { useSchool } from '../schools/schoolQueries';
import {
  fetchTransactionsPage,
  useAllMembershipPlans,
  useDeskPaymentOptions,
  NO_FILTERS,
  useRecordDeskPayment,
  useSettleTransaction,
  useTransactionReceiptUrl,
  useTransactions,
  useTransactionSummary,
  type TransactionFilters,
  type TransactionResponse,
} from './transactionQueries';
import { downloadCsv, transactionsCsv } from './transactionsCsv';
import { useT } from '../i18n/I18nProvider';
import { PAYMENT_METHOD_LABELS } from '../lib/enumLabels';
import { formatLocale } from '../i18n/format';

/** How a desk payment was taken (Decision 348's desk methods). */
type DeskMethod = 'CASH' | 'BANK_TRANSFER' | 'PIX' | 'CARD_TERMINAL';

/** One "Receipt" cell — a drill-down from the table, not a bulk action, so it's
 * its own small component (one `useTransactionReceiptUrl()` call per row)
 * rather than a single mutation shared across the whole table. Only card rows
 * get one (Decision 339, T7): Cash/Bank Transfer has no receipt to show. `null`
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
 * (Decision 339, G1). Asks first, naming the Student, plan and amount, since
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
  const vars = { student: studentName(row), plan: row.membershipPlanTitle ?? '', amount: formatMoney(row.amount, row.currency) };

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

/** What a row was for: the plan, a later renewal of it, or a late-cancellation
 * fee naming its class (Decision 346). */
function useItemLabel() {
  const t = useT();
  return (row: TransactionResponse): string => {
    if (row.kind === 'LATE_CANCEL_FEE') {
      return row.bookingClassTitle ? t('transactions.itemLateFee', { class: row.bookingClassTitle }) : t('transactions.kindLateFee');
    }
    const plan = row.membershipPlanTitle ?? '';
    // Decision 404: a freeze fee names the frozen membership's plan.
    if (row.kind === 'FREEZE_FEE') return plan ? t('transactions.itemFreezeFee', { plan }) : t('transactions.kindFreezeFee');
    return row.kind === 'RENEWAL' ? t('transactions.itemRenewal', { plan }) : plan;
  };
}

const KIND_LABELS = {
  MEMBERSHIP: 'transactions.kindMembership',
  RENEWAL: 'transactions.kindRenewal',
  LATE_CANCEL_FEE: 'transactions.kindLateFee',
  FREEZE_FEE: 'transactions.kindFreezeFee',
} as const;

/** "Record a payment" (Decision 346, G7): cash or a bank transfer the School
 * took in person. Picks a current Student and a plan that can be paid this way
 * (no Subscriptions, no Friend Passes, nothing archived); the membership starts
 * as soon as it is saved. */
function RecordPaymentDialog({ schoolId, onClose, onRecorded }: { schoolId: string; onClose: () => void; onRecorded?: () => void }) {
  const t = useT();
  const { data: options } = useDeskPaymentOptions(schoolId);
  const record = useRecordDeskPayment(schoolId);
  const [studentId, setStudentId] = useState('');
  const [planId, setPlanId] = useState('');
  const [method, setMethod] = useState<DeskMethod>('CASH');
  const [error, setError] = useState<string | null>(null);
  const students = options?.students ?? [];
  const plans = options?.plans ?? [];
  const plan = plans.find((p) => p.id === planId);

  async function handleSave() {
    setError(null);
    try {
      await record.mutateAsync({ studentId, membershipPlanId: planId, paymentMethod: method });
      onRecorded?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('transactions.recordFailed'));
    }
  }

  return (
    <Modal title={t('transactions.recordTitle')} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ margin: '0 0 16px' }}>{t('transactions.recordBody')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label={t('transactions.recordStudent')} htmlFor="record-student">
          <SelectField
            id="record-student"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            options={[{ value: '', label: t('transactions.recordPick') }, ...students.map((s) => ({ value: s.id, label: `${s.firstName} ${s.surname}`.trim() }))]}
          />
        </Field>
        <Field label={t('transactions.recordPlan')} htmlFor="record-plan" hint={plans.length === 0 ? t('transactions.recordNoPlans') : undefined}>
          <SelectField
            id="record-plan"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            options={[
              { value: '', label: t('transactions.recordPick') },
              ...plans.map((p) => ({ value: p.id, label: `${p.title} (${formatMoney(p.price, p.currency ?? null)})` })),
            ]}
          />
        </Field>
        <Field label={t('transactions.columnMethod')} htmlFor="record-method">
          <SelectField
            id="record-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as DeskMethod)}
            options={[
              { value: 'CASH', label: t('lib.paymentMethod.cash') },
              { value: 'BANK_TRANSFER', label: t('lib.paymentMethod.bankTransfer') },
              { value: 'PIX', label: t('lib.paymentMethod.pix') },
              { value: 'CARD_TERMINAL', label: t('lib.paymentMethod.cardTerminal') },
            ]}
          />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>
          {t('transactions.back')}
        </Button>
        <Button disabled={!studentId || !plan} loading={record.isPending} onClick={handleSave}>
          {plan ? t('transactions.recordSave', { amount: formatMoney(plan.price, plan.currency ?? null) }) : t('transactions.recordSaveNoAmount')}
        </Button>
      </div>
    </Modal>
  );
}

/** Branch Staff and coaches: no ledger. Branch Staff get Record a payment
 * when the owner has switched it on for the School (Decision 347); everyone
 * else sees why the page is empty (T5). */
function StaffDeskPayment() {
  const t = useT();
  const { claims } = useAuth();
  const schoolId = useCoachSchoolId();
  const isBranchStaff = !!claims?.grants.some((g) => g.role === 'BRANCH_STAFF' && g.schoolId === schoolId);
  const { data: school, isLoading } = useSchool(isBranchStaff ? schoolId : null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  if (isBranchStaff && isLoading) return <Spinner />;
  if (!schoolId || !isBranchStaff || !school?.branchStaffCanRecordPayments) {
    return <EmptyState title={t('transactions.ownerOnlyTitle')} description={t('transactions.ownerOnlyDescription')} />;
  }
  return (
    <>
      <PageHeader title={t('transactions.recordTitle')} subtitle={school.name} />
      {recorded ? <SuccessBanner message={t('transactions.recorded')} /> : null}
      <Card>
        <p style={{ marginTop: 0 }}>{t('transactions.staffBody')}</p>
        <Button
          onClick={() => {
            setRecorded(false);
            setRecording(true);
          }}
        >
          {t('transactions.recordPayment')}
        </Button>
      </Card>
      {recording ? <RecordPaymentDialog schoolId={schoolId} onClose={() => setRecording(false)} onRecorded={() => setRecorded(true)} /> : null}
    </>
  );
}

/** The School's payment ledger, newest first, a page at a time (Decision 339).
 * The tiles count the whole ledger on the server, not the page on screen.
 * Pending Cash/Bank Transfer rows can be marked paid or cancelled. */
export function TransactionsPage() {
  const t = useT();
  const itemLabel = useItemLabel();
  const schoolId = useOwnedSchoolId();
  const [filters, setFilters] = useState<TransactionFilters>(NO_FILTERS);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const { data, isLoading, error } = useTransactions(schoolId, cursorStack[pageIndex], filters);
  const { data: summary } = useTransactionSummary(schoolId, filters);
  const { data: planData } = useAllMembershipPlans(schoolId);
  const [settling, setSettling] = useState<{ row: TransactionResponse; action: SettleAction } | null>(null);
  const [recording, setRecording] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Back to page 1 when the owner switches School or changes a filter.
  useEffect(() => {
    setCursorStack([null]);
    setPageIndex(0);
  }, [schoolId, filters]);

  // Branch Staff and Instructors: the menu hides this page, but the address
  // still works — say why it's empty rather than showing a blank page (T5).
  if (!schoolId) return <StaffDeskPayment />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('transactions.loadFailed')} />;

  const transactions = data?.items ?? [];
  const revenueLabel = (summary?.revenue ?? []).map((r) => formatMoney(r.amount, r.currency ?? null)).join(' + ');
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const setFilter = <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const methodLabel = (row: TransactionResponse) => (PAYMENT_METHOD_LABELS[row.paymentMethod] ? t(PAYMENT_METHOD_LABELS[row.paymentMethod]!) : row.paymentMethod);
  const statusLabel = (row: TransactionResponse) => (PAYMENT_STATUS_LABELS[row.status] ? t(PAYMENT_STATUS_LABELS[row.status]!) : row.status);

  function goToNextPage(nextCursor: string | null) {
    setCursorStack((stack) => [...stack.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
  }

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const rows = await fetchAllPages((cursor) => fetchTransactionsPage(schoolId!, filters, cursor, ALL_PAGES_LIMIT));
      const csv = transactionsCsv(rows, {
        headers: [
          t('transactions.columnDate'),
          t('transactions.columnStudent'),
          t('transactions.columnPlan'),
          t('transactions.columnKind'),
          t('transactions.columnAmount'),
          t('transactions.columnCurrency'),
          t('transactions.columnStatus'),
          t('transactions.columnMethod'),
          t('transactions.columnRefunded'),
          t('transactions.columnDisputed'),
          t('transactions.columnId'),
        ],
        item: itemLabel,
        student: studentName,
        kind: (row) => t(KIND_LABELS[row.kind]),
        status: statusLabel,
        method: methodLabel,
      });
      downloadCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : t('transactions.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('transactions.title')}
        subtitle={t('transactions.subtitle')}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" loading={exporting} onClick={handleExport}>
              {t('transactions.exportCsv')}
            </Button>
            <Button onClick={() => setRecording(true)}>{t('transactions.recordPayment')}</Button>
          </div>
        }
      />
      {exportError ? <ErrorBanner message={exportError} /> : null}

      {/* Filters (Decision 346, G3) narrow the rows, the tiles and the export. */}
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}>
            <Field label={t('transactions.columnStatus')} htmlFor="tx-filter-status">
              <SelectField
                id="tx-filter-status"
                value={filters.status}
                onChange={(e) => setFilter('status', e.target.value as TransactionFilters['status'])}
                options={[
                  { value: '', label: t('transactions.filterAny') },
                  ...Object.entries(PAYMENT_STATUS_LABELS).map(([value, key]) => ({ value, label: t(key) })),
                ]}
              />
            </Field>
          </div>
          <div style={{ minWidth: 150 }}>
            <Field label={t('transactions.columnMethod')} htmlFor="tx-filter-method">
              <SelectField
                id="tx-filter-method"
                value={filters.paymentMethod}
                onChange={(e) => setFilter('paymentMethod', e.target.value as TransactionFilters['paymentMethod'])}
                options={[
                  { value: '', label: t('transactions.filterAny') },
                  ...Object.entries(PAYMENT_METHOD_LABELS).map(([value, key]) => ({ value, label: t(key) })),
                ]}
              />
            </Field>
          </div>
          <div style={{ minWidth: 170 }}>
            <Field label={t('transactions.columnKind')} htmlFor="tx-filter-kind">
              <SelectField
                id="tx-filter-kind"
                value={filters.kind}
                onChange={(e) => setFilter('kind', e.target.value as TransactionFilters['kind'])}
                options={[
                  { value: '', label: t('transactions.filterAny') },
                  ...Object.entries(KIND_LABELS).map(([value, key]) => ({ value, label: t(key) })),
                ]}
              />
            </Field>
          </div>
          <div style={{ minWidth: 180 }}>
            <Field label={t('transactions.columnPlan')} htmlFor="tx-filter-plan">
              <SelectField
                id="tx-filter-plan"
                value={filters.membershipPlanId}
                onChange={(e) => setFilter('membershipPlanId', e.target.value)}
                options={[{ value: '', label: t('transactions.filterAny') }, ...(planData ?? []).map((p) => ({ value: p.id, label: p.title }))]}
              />
            </Field>
          </div>
          <div style={{ minWidth: 150 }}>
            <Field label={t('transactions.filterFrom')} htmlFor="tx-filter-from">
              <TextField id="tx-filter-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
            </Field>
          </div>
          <div style={{ minWidth: 150 }}>
            <Field label={t('transactions.filterTo')} htmlFor="tx-filter-to">
              <TextField id="tx-filter-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
            </Field>
          </div>
          {filtered ? (
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              {t('transactions.filterClear')}
            </Button>
          ) : null}
        </div>
      </Card>

      {/* Stats ribbon — counted over the whole ledger (or the filtered rows) by
          GET /schools/:id/transactions/summary (Decisions 339, 346). */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '24px 0' }}>
        <StatTile label={t('transactions.statTotal')} value={summary?.total ?? '—'} />
        <StatTile label={t('transactions.statSuccessful')} value={summary?.successful ?? '—'} />
        <StatTile label={t('transactions.statPending')} value={summary?.pending ?? '—'} />
        <StatTile label={t('transactions.statFailedOrDisputed')} value={summary?.failedOrDisputed ?? '—'} />
        <StatTile label={t('transactions.statRevenue')} value={summary ? revenueLabel || formatMoney(0, null) : '—'} />
      </div>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : transactions.length === 0 ? (
          filtered ? (
            <EmptyState title={t('transactions.noMatchTitle')} description={t('transactions.noMatchDescription')} />
          ) : (
            <EmptyState title={t('transactions.emptyTitle')} description={t('transactions.emptyDescription')} />
          )
        ) : (
          <Table<TransactionResponse>
            rows={transactions}
            columns={[
              { key: 'billingDate', header: t('transactions.columnDate'), render: (row) => new Date(row.billingDate).toLocaleString(formatLocale()) },
              // The server sends the plan's name with each row (T6); a renewal or
              // a late-cancellation fee says so (Decision 346).
              { key: 'plan', header: t('transactions.columnPlan'), render: (row) => itemLabel(row) },
              { key: 'student', header: t('transactions.columnStudent'), render: (row) => studentName(row) },
              { key: 'amount', header: t('transactions.columnAmount'), render: (row) => formatMoney(row.amount, row.currency) },
              { key: 'status', header: t('transactions.columnStatus'), render: (row) => paymentStatusBadge(row.status) },
              {
                key: 'paymentMethod',
                header: t('transactions.columnMethod'),
                render: (row) => (row.recordedById ? `${methodLabel(row)} · ${t('transactions.atDesk')}` : methodLabel(row)),
              },
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
      {recording ? <RecordPaymentDialog schoolId={schoolId} onClose={() => setRecording(false)} /> : null}
    </>
  );
}
