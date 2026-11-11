import React, { useEffect, useState } from 'react';
import { Button, EmptyState, ErrorBanner, Field, Modal, SelectField, Spinner, SuccessBanner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { formatMoney } from '../lib/money';
import { PAYMENT_STATUS_LABELS, paymentStatusBadge, transactionStatus } from '../lib/paymentStatusBadge';
import { fetchAllPages, ALL_PAGES_LIMIT } from '../lib/fetchAllPages';
import { useSchool } from '../schools/schoolQueries';
import {
  fetchTransactionsPage,
  useAllMembershipPlans,
  useDeskPaymentOptions,
  NO_FILTERS,
  useRecordDeskPayment,
  useConfirmTransaction,
  useTransactionReceiptUrl,
  useTransactions,
  useTransactionSummary,
  type TransactionFilters,
  type TransactionResponse,
} from './transactionQueries';
import { downloadCsv, transactionsCsv } from './transactionsCsv';
import { CancelPaymentModal } from './CancelPaymentModal';
import { RefundDeskSaleModal } from './RefundDeskSaleModal';
import { useT } from '../i18n/I18nProvider';
import { PAYMENT_METHOD_LABELS } from '../lib/enumLabels';
import { formatLocale } from '../i18n/format';
import { offersPix, useDeskMethods } from '../lib/deskMethods';
import { JoiningFeeNotice, useDeskTotal } from '../membershipPlans/JoiningFeeNotice';
import { BillingCard, BillingDate, BillingMore, BillingPage, BillingSelect, BillingStat, BillingStats } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';

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
      <Button variant="secondary" className="u8b-pill u8b-pill--row" loading={getReceiptUrl.isPending} onClick={handleClick}>
        {t('transactions.receipt')}
      </Button>
      {error ? <div style={{ color: 'var(--text-danger)', fontSize: 12 }}>{error}</div> : null}
    </div>
  );
}

/** "Mark as paid" for one Pending Cash/Bank Transfer payment (Decision 339,
 * G1). Asks first, naming the Student, plan and amount, since marking it paid
 * creates their Membership and can't be undone here. Cancelling has its own
 * dialog, which asks for a reason (CancelPaymentModal, Decision 338 item 1). */
function MarkPaidDialog({ row, schoolId, onClose }: { row: TransactionResponse; schoolId: string; onClose: () => void }) {
  const t = useT();
  const settle = useConfirmTransaction(schoolId);
  const [error, setError] = useState<string | null>(null);
  const vars = { student: studentName(row), plan: row.membershipPlanTitle ?? '', amount: formatMoney(row.amount, row.currency) };

  async function handleConfirm() {
    setError(null);
    try {
      await settle.mutateAsync(row.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('transactions.settleFailed'));
    }
  }

  return (
    <Modal title={t('transactions.markPaidTitle')} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ margin: '0 0 16px' }}>{t('transactions.markPaidBody', vars)}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>
          {t('transactions.back')}
        </Button>
        <Button variant="primary" loading={settle.isPending} onClick={handleConfirm}>
          {t('transactions.markPaid')}
        </Button>
      </div>
    </Modal>
  );
}

/** A cancelled payment's line under its status (Decision 338 item 1): when,
 * who, and the staff-only reason. */
function cancelledLine(t: ReturnType<typeof useT>, row: TransactionResponse): string | null {
  if (!row.cancelledAt) return null;
  const date = new Date(row.cancelledAt).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
  const name = row.cancelledByName ?? '';
  return row.cancelReason ? t('charges.card.cancelledLine', { date, name, reason: row.cancelReason }) : t('charges.card.cancelledNoReason', { date, name });
}

/** Decision 431 (MON-8): a membership paid at the desk (not by card in the
 * app), taken, with something left to give back. */
function isRefundableDeskSale(row: TransactionResponse): boolean {
  // Decision 435 item 5: a non-refundable joining fee never counts as left.
  const kept = row.joiningFeeRefundable ? 0 : (row.joiningFeeAmount ?? 0);
  return row.kind === 'MEMBERSHIP' && row.paymentMethod !== 'STRIPE' && row.status === 'SUCCESSFUL' && (row.refundedAmount ?? 0) < row.amount - kept;
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
    // Decision 448 item 18: a no-show fee names its class too.
    if (row.kind === 'NO_SHOW_FEE') {
      return row.bookingClassTitle ? t('transactions.itemNoShowFee', { class: row.bookingClassTitle }) : t('transactions.kindNoShowFee');
    }
    const plan = row.membershipPlanTitle ?? '';
    // Decision 404: a freeze fee names the frozen membership's plan.
    if (row.kind === 'FREEZE_FEE') return plan ? t('transactions.itemFreezeFee', { plan }) : t('transactions.kindFreezeFee');
    // Decision 338 item 9: a desk payment toward a staff-created charge.
    if (row.kind === 'CHARGE_PAYMENT') {
      return row.chargeInvoiceLabel
        ? t('charges.transactions.item', { invoice: row.chargeInvoiceLabel, description: row.chargeDescription ?? '' })
        : t('charges.transactions.itemBalance');
    }
    return row.kind === 'RENEWAL' ? t('transactions.itemRenewal', { plan }) : plan;
  };
}

const KIND_LABELS = {
  MEMBERSHIP: 'transactions.kindMembership',
  RENEWAL: 'transactions.kindRenewal',
  LATE_CANCEL_FEE: 'transactions.kindLateFee',
  FREEZE_FEE: 'transactions.kindFreezeFee',
  CHARGE_PAYMENT: 'charges.transactions.kind',
  NO_SHOW_FEE: 'transactions.kindNoShowFee',
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
  // Decision 435: a first plan's joining fee is collected with it.
  const deskTotal = useDeskTotal(plan?.id ?? null, studentId || null, plan?.price ?? 0);
  // Decision 448 item 5: Pix only for a School in Brazil.
  const methods = useDeskMethods(schoolId, ['CASH', 'BANK_TRANSFER', 'PIX', 'CARD_TERMINAL'] as const);

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
      <p style={{ margin: '0 0 16px' }}>{t(methods.includes('PIX') ? 'transactions.recordBodyPix' : 'transactions.recordBody')}</p>
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
        {plan ? <JoiningFeeNotice planId={plan.id} studentId={studentId || null} price={plan.price} currency={plan.currency ?? null} /> : null}
        <Field label={t('transactions.columnMethod')} htmlFor="record-method">
          <SelectField
            id="record-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as DeskMethod)}
            options={methods.map((m) => ({ value: m, label: t(PAYMENT_METHOD_LABELS[m]) }))}
          />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>
          {t('transactions.back')}
        </Button>
        <Button disabled={!studentId || !plan} loading={record.isPending} onClick={handleSave}>
          {plan ? t('transactions.recordSave', { amount: formatMoney(deskTotal, plan.currency ?? null) }) : t('transactions.recordSaveNoAmount')}
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
    return (
      <BillingPage>
        <NewLookPageHeader title={t('transactions.title')} />
        <BillingCard>
          <EmptyState title={t('transactions.ownerOnlyTitle')} description={t('transactions.ownerOnlyDescription')} />
        </BillingCard>
      </BillingPage>
    );
  }
  return (
    <BillingPage>
      <NewLookPageHeader title={t('transactions.recordTitle')} subtitle={school.name} />
      {recorded ? <SuccessBanner message={t('transactions.recorded')} /> : null}
      <BillingCard>
        <p style={{ marginTop: 0 }}>{t('transactions.staffBody')}</p>
        <Button
          className="u8b-pill u8b-pill--primary"
          onClick={() => {
            setRecorded(false);
            setRecording(true);
          }}
        >
          {t('transactions.recordPayment')}
        </Button>
      </BillingCard>
      {recording ? <RecordPaymentDialog schoolId={schoolId} onClose={() => setRecording(false)} onRecorded={() => setRecorded(true)} /> : null}
    </BillingPage>
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
  const [settling, setSettling] = useState<{ row: TransactionResponse; action: 'confirm' | 'cancel' | 'refund' } | null>(null);
  // The School's "reason required" setting for cancelling (Decision 338 item 1).
  const { data: school } = useSchool(schoolId);
  const pix = offersPix(school);
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
  // Decision 448 item 1: the card surcharge is its own tile, apart from the
  // price of what was sold (shown once any surcharge was kept).
  const surcharges = (summary?.surcharges ?? []).filter((r) => r.amount > 0);
  const surchargesLabel = surcharges.map((r) => formatMoney(r.amount, r.currency ?? null)).join(' + ');
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const setFilter = <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const methodLabel = (row: TransactionResponse) => (PAYMENT_METHOD_LABELS[row.paymentMethod] ? t(PAYMENT_METHOD_LABELS[row.paymentMethod]!) : row.paymentMethod);
  const statusLabel = (row: TransactionResponse) => {
    const status = transactionStatus(row);
    return PAYMENT_STATUS_LABELS[status] ? t(PAYMENT_STATUS_LABELS[status]!) : status;
  };

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
          t('transactions.columnDateSchoolTime'),
          t('transactions.columnStudent'),
          t('transactions.columnPlan'),
          t('transactions.columnKind'),
          t('transactions.columnAmount'),
          t('transactions.columnSurcharge'),
          t('transactions.columnCurrency'),
          t('transactions.columnStatus'),
          t('transactions.columnMethod'),
          t('transactions.columnRefunded'),
          t('transactions.columnDisputed'),
          t('transactions.columnId'),
          t('transactions.columnCancelledAt'),
          t('transactions.columnCancelledBy'),
          t('transactions.columnCancelReason'),
          t('transactions.columnIncomeCategory'),
        ],
        item: itemLabel,
        student: studentName,
        kind: (row) => t(KIND_LABELS[row.kind]),
        status: statusLabel,
        method: methodLabel,
        timeZone: school?.timezone ?? null,
      });
      downloadCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : t('transactions.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <BillingPage>
      <NewLookPageHeader
        title={t('transactions.title')}
        subtitle={t('transactions.subtitle')}
        actions={
          <>
            <Button className="u8b-pill u8b-pill--primary" onClick={() => setRecording(true)}>
              {t('transactions.recordPayment')}
            </Button>
            {/* Export CSV is a secondary action: under ⋯ More on a phone. */}
            <BillingMore>
              <Button variant="secondary" className="u8b-pill" loading={exporting} onClick={handleExport}>
                {t('transactions.exportCsv')}
              </Button>
            </BillingMore>
          </>
        }
      />
      {exportError ? <ErrorBanner message={exportError} /> : null}

      {/* One list card: the filters (Decision 346, G3), which narrow the rows,
          the tiles and the export; the tiles, counted over the whole ledger (or
          the filtered rows) by GET /schools/:id/transactions/summary (Decisions
          339, 346); the rows; and Prev / Next. */}
      <BillingCard
        flush
        toolbar={
          <div className="u8b-toolbar__group">
            <BillingSelect
              id="tx-filter-status"
              label={t('transactions.columnStatus')}
              value={filters.status}
              onChange={(v) => setFilter('status', v as TransactionFilters['status'])}
              options={[
                { value: '', label: t('transactions.filterAny') },
                ...Object.entries(PAYMENT_STATUS_LABELS).map(([value, key]) => ({ value, label: t(key) })),
              ]}
            />
            <BillingSelect
              id="tx-filter-method"
              label={t('transactions.columnMethod')}
              value={filters.paymentMethod}
              onChange={(v) => setFilter('paymentMethod', v as TransactionFilters['paymentMethod'])}
              options={[
                { value: '', label: t('transactions.filterAny') },
                // Decision 448 item 5: Pix only at a School in Brazil.
                ...Object.entries(PAYMENT_METHOD_LABELS)
                  .filter(([value]) => value !== 'PIX' || pix)
                  .map(([value, key]) => ({ value, label: t(key) })),
              ]}
            />
            <BillingSelect
              id="tx-filter-kind"
              label={t('transactions.columnKind')}
              value={filters.kind}
              onChange={(v) => setFilter('kind', v as TransactionFilters['kind'])}
              options={[
                { value: '', label: t('transactions.filterAny') },
                ...Object.entries(KIND_LABELS).map(([value, key]) => ({ value, label: t(key) })),
              ]}
            />
            <BillingSelect
              id="tx-filter-plan"
              label={t('transactions.columnPlan')}
              value={filters.membershipPlanId}
              onChange={(v) => setFilter('membershipPlanId', v)}
              options={[{ value: '', label: t('transactions.filterAny') }, ...(planData ?? []).map((p) => ({ value: p.id, label: p.title }))]}
            />
            <BillingDate id="tx-filter-from" label={t('transactions.filterFrom')} value={filters.from} max={filters.to || undefined} onChange={(v) => setFilter('from', v)} />
            <BillingDate id="tx-filter-to" label={t('transactions.filterTo')} value={filters.to} min={filters.from || undefined} onChange={(v) => setFilter('to', v)} />
            {filtered ? (
              <div className="u8b-select">
                <span className="u8b-select__label" aria-hidden="true">
                  &nbsp;
                </span>
                <Button variant="secondary" className="u8b-pill" onClick={() => setFilters(NO_FILTERS)}>
                  {t('transactions.filterClear')}
                </Button>
              </div>
            ) : null}
          </div>
        }
      >
        <BillingStats>
          <BillingStat label={t('transactions.statTotal')} value={summary?.total ?? '—'} />
          <BillingStat label={t('transactions.statSuccessful')} value={summary?.successful ?? '—'} />
          <BillingStat label={t('transactions.statPending')} value={summary?.pending ?? '—'} />
          <BillingStat label={t('transactions.statFailedOrDisputed')} value={summary?.failedOrDisputed ?? '—'} />
          <BillingStat label={t('transactions.statCancelled')} value={summary?.cancelled ?? '—'} />
          <BillingStat label={t('transactions.statRevenue')} value={summary ? revenueLabel || formatMoney(0, null) : '—'} />
          {surcharges.length > 0 ? <BillingStat label={t('transactions.statSurcharges')} value={surchargesLabel} /> : null}
        </BillingStats>

        {isLoading ? (
          <div className="u8b-pad" style={{ padding: 20 }}>
            <Spinner />
          </div>
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
              { key: 'student', header: t('transactions.columnStudent'), render: (row) => <span className="u8b-name">{studentName(row)}</span> },
              {
                key: 'amount',
                header: t('transactions.columnAmount'),
                // Decision 406: a card surcharge is its own line under the plan's price.
                render: (row) =>
                  row.surchargeAmount > 0 ? (
                    <div>
                      <div>{formatMoney(row.amount, row.currency)}</div>
                      <div className="ultm8-field__hint">{t('transactions.surchargeLine', { amount: formatMoney(row.surchargeAmount, row.currency) })}</div>
                    </div>
                  ) : (
                    formatMoney(row.amount, row.currency)
                  ),
              },
              {
                key: 'status',
                header: t('transactions.columnStatus'),
                // Decision 338 item 1: a cancelled payment reads Cancelled,
                // with when, who and why underneath.
                render: (row) =>
                  row.cancelledAt ? (
                    <div>
                      {paymentStatusBadge(transactionStatus(row))}
                      <div className="ultm8-field__hint">{cancelledLine(t, row)}</div>
                    </div>
                  ) : (
                    paymentStatusBadge(row.status)
                  ),
              },
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
                    <div className="u8b-row-actions">
                      <Button variant="secondary" className="u8b-pill u8b-pill--row" onClick={() => setSettling({ row, action: 'confirm' })}>
                        {t('transactions.markPaid')}
                      </Button>
                      <Button variant="secondary" className="u8b-pill u8b-pill--row" onClick={() => setSettling({ row, action: 'cancel' })}>
                        {t('transactions.cancelPayment')}
                      </Button>
                    </div>
                  ) : isRefundableDeskSale(row) ? (
                    // Decision 431 (MON-8): a membership paid at the desk can be refunded by hand.
                    <Button variant="secondary" className="u8b-pill u8b-pill--row" onClick={() => setSettling({ row, action: 'refund' })}>
                      {t('transactions.refund.action')}
                    </Button>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        )}

        {transactions.length > 0 || pageIndex > 0 ? (
          <div className="u8b-foot">
            <Button variant="secondary" className="u8b-pill u8b-pill--row" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => Math.max(0, i - 1))}>
              {t('transactions.prev')}
            </Button>
            <Button variant="secondary" className="u8b-pill u8b-pill--row" disabled={!data?.nextCursor} onClick={() => goToNextPage(data!.nextCursor ?? null)}>
              {t('transactions.next')}
            </Button>
            <span>{t('transactions.page', { page: pageIndex + 1 })}</span>
          </div>
        ) : null}
      </BillingCard>

      {settling?.action === 'confirm' ? <MarkPaidDialog row={settling.row} schoolId={schoolId} onClose={() => setSettling(null)} /> : null}
      {settling?.action === 'cancel' ? (
        <CancelPaymentModal
          schoolId={schoolId}
          payment={{ id: settling.row.id, amount: settling.row.amount, currency: settling.row.currency ?? null, planTitle: settling.row.membershipPlanTitle ?? '' }}
          studentName={studentName(settling.row)}
          reasonRequired={school?.chargeCancelReasonRequired ?? true}
          onClose={() => setSettling(null)}
        />
      ) : null}
      {settling?.action === 'refund' ? (
        <RefundDeskSaleModal
          schoolId={schoolId}
          payment={{
            id: settling.row.id,
            amount: settling.row.amount,
            refundedAmount: settling.row.refundedAmount ?? null,
            currency: settling.row.currency ?? null,
            planTitle: settling.row.membershipPlanTitle ?? '',
            // Decision 435 item 5: a non-refundable joining fee stays out.
            keptJoiningFee: settling.row.joiningFeeRefundable ? 0 : (settling.row.joiningFeeAmount ?? 0),
          }}
          studentName={studentName(settling.row)}
          onClose={() => setSettling(null)}
        />
      ) : null}
      {recording ? <RecordPaymentDialog schoolId={schoolId} onClose={() => setRecording(false)} /> : null}
    </BillingPage>
  );
}
