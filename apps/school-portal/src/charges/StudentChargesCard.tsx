import React, { useState } from 'react';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Modal, SelectField, Spinner, SuccessBanner, Table, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { formatMoney } from '../lib/money';
import { MoneyField } from '../lib/MoneyField';
import { PAYMENT_METHOD_LABELS } from '../lib/enumLabels';
import {
  CHARGE_PAYMENT_METHODS,
  parseRate,
  previewCharge,
  rateText,
  useCancelCharge,
  useCreateCharge,
  useGiveCredit,
  useRecordChargePayment,
  useRefundChargePayment,
  useResendInvoice,
  useStudentCharges,
  useStudentRecurringCharges,
  type BalanceCredit,
  type Charge,
  type ChargeBalance,
  type ChargePayment,
  type DeskMembershipPayment,
  type StudentCharges,
} from './chargeQueries';
import { useWaiveLateFee } from './lateFeeQueries';
import { CancelPaymentModal } from '../transactions/CancelPaymentModal';
import { paymentStatusBadge } from '../lib/paymentStatusBadge';
import { CreateRecurringChargeModal, RecurringChargesList } from './RecurringCharges';

const STATUS_BADGE: Record<Charge['status'], 'default' | 'success' | 'warning' | 'info'> = {
  OPEN: 'warning',
  PART_PAID: 'info',
  PAID: 'success',
  CANCELLED: 'default',
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** A charge's name: its description, or "Late fee" for a late fee (Decision
 * 413), whose stored description is the API's English. */
function chargeTitle(t: ReturnType<typeof useT>, c: Charge): string {
  return c.lateFee ? t('charges.lateFee.badge') : c.description;
}

/** Decision 413: what a late fee is for, and how it was worked out. */
function LateFeeLines({ charge: c }: { charge: Charge }) {
  const t = useT();
  const f = c.lateFee;
  if (!f) return null;
  return (
    <>
      <div className="ultm8-field__hint">
        {f.forType === 'CHARGE'
          ? t('charges.lateFee.forInvoice', { invoice: f.forInvoiceLabel ?? '', description: f.forDescription ?? '', date: formatDay(f.forDueDate) })
          : t('charges.lateFee.forRenewal', { plan: f.forPlanTitle ?? '', amount: formatMoney(f.overdueAmount, f.overdueCurrency), date: formatDay(f.forDueDate) })}
      </div>
      {f.percentBps ? (
        <div className="ultm8-field__hint">{t('charges.lateFee.percent', { percent: rateText(f.percentBps), amount: formatMoney(f.overdueAmount, f.overdueCurrency) })}</div>
      ) : null}
    </>
  );
}

/**
 * Backlog §3.6 step 6 (Decision 303 item 5): a promotion fee's charge, with
 * the style and grade it is for and a link to that style's grading card on
 * this page. Waived or cancelled from grading, which cancels the charge; the
 * Payments card can't cancel it.
 */
function PromotionFeeLines({ charge: c }: { charge: Charge }) {
  const t = useT();
  const f = c.promotionFee;
  if (!f) return null;
  return (
    <>
      <div className="ultm8-field__hint">
        {t('charges.promotionFee.forRank', { style: f.disciplineName, rank: f.toRungName })} ·{' '}
        <a href={`#grading-${f.disciplineId}`} data-testid="promotion-fee-grading-link">
          {t('charges.promotionFee.seeGrading')}
        </a>
      </div>
      {c.status === 'CANCELLED' && c.cancelledAt && (f.status === 'WAIVED' || f.status === 'CANCELLED') ? (
        <div className="ultm8-field__hint">
          {t(f.status === 'WAIVED' ? 'charges.promotionFee.waivedLine' : 'charges.promotionFee.cancelledLine', {
            date: formatDay(c.cancelledAt.slice(0, 10)),
            name: c.cancelledByName ?? '',
          })}
        </div>
      ) : null}
    </>
  );
}

/** How a payment was made: a desk method, or a card paid in the app or
 * charged automatically (backlog §3.6 step 2). */
function paymentMethodText(t: ReturnType<typeof useT>, p: ChargePayment): string {
  if (p.channel === 'APP') return t('charges.card.methodApp');
  if (p.channel === 'AUTOMATIC') return t('charges.card.methodAutomatic');
  return PAYMENT_METHOD_LABELS[p.paymentMethod] ? t(PAYMENT_METHOD_LABELS[p.paymentMethod]) : p.paymentMethod;
}

/**
 * The student page's Payments card (v1.3 backlog §3.6, step 1; Decisions
 * 303, 338): the balance (red when something is overdue), the student's
 * charges with their invoice number, price ex. tax, tax and total, and the
 * desk payments. "+ Create charge", "Record payment" and "Cancel" show only
 * to staff who may use them; a staff member who may do none of them doesn't
 * see the card (the API answers 403).
 */
export function StudentChargesCard({ schoolId, studentId, studentName }: { schoolId: string; studentId: string; studentName: string }) {
  const t = useT();
  const charges = useStudentCharges(schoolId, studentId);
  const recurring = useStudentRecurringCharges(schoolId, studentId);
  const [dialog, setDialog] = useState<'create' | 'recurring' | { pay: string | null } | null>(null);
  const [cancelling, setCancelling] = useState<Charge | null>(null);
  const [waiving, setWaiving] = useState<Charge | null>(null);
  const [cancellingPayment, setCancellingPayment] = useState<DeskMembershipPayment | null>(null);
  const [refunding, setRefunding] = useState<ChargePayment | null>(null);
  const [crediting, setCrediting] = useState(false);
  const resend = useResendInvoice(schoolId);
  const [resent, setResent] = useState<'ok' | 'failed' | null>(null);

  async function resendInvoice(charge: Charge) {
    setResent(null);
    try {
      await resend.mutateAsync(charge.id);
      setResent('ok');
    } catch {
      setResent('failed');
    }
  }

  if (charges.error instanceof ApiError && charges.error.status === 403) return null;

  return (
    <div id="student-payments" style={{ marginBottom: 24 }}>
      <Card>
        <div data-testid="student-charges" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 4 }}>
              {t('charges.card.title')}
            </h2>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('charges.card.subtitle')}</p>
            {charges.data ? <BalanceLine balances={charges.data.balances} /> : null}
          </div>
          {charges.data ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {charges.data.can.create ? <Button onClick={() => setDialog('create')}>{t('charges.card.create')}</Button> : null}
              {recurring.data?.can.create ? (
                <Button variant="secondary" onClick={() => setDialog('recurring')}>
                  {t('charges.recurring.add')}
                </Button>
              ) : null}
              {charges.data.can.recordPayment ? (
                <Button variant="secondary" onClick={() => setDialog({ pay: null })} disabled={!charges.data.settings.paymentsSetUp}>
                  {t('charges.card.recordPayment')}
                </Button>
              ) : null}
              {charges.data.can.addCredit && charges.data.settings.currency ? (
                <Button variant="secondary" onClick={() => setCrediting(true)}>
                  {t('charges.card.addCredit')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {charges.isLoading ? (
          <Spinner />
        ) : charges.error ? (
          <ErrorBanner message={errorText(charges.error, t('charges.card.loadFailed'))} />
        ) : charges.data ? (
          <>
            {resent === 'ok' ? <SuccessBanner message={t('charges.card.resent')} /> : null}
            {resent === 'failed' ? <ErrorBanner message={t('charges.card.resendFailed')} /> : null}
            <ChargesBody
              data={charges.data}
              onPay={(id) => setDialog({ pay: id })}
              onCancel={setCancelling}
              onWaive={setWaiving}
              onRefund={setRefunding}
              onResend={(c) => void resendInvoice(c)}
              resending={resend.isPending}
            />
            {charges.data.deskMembershipPayments.length > 0 ? (
              <DeskMembershipPayments payments={charges.data.deskMembershipPayments} canCancel={charges.data.can.cancel} onCancel={setCancellingPayment} />
            ) : null}
            {recurring.data ? <RecurringChargesList schoolId={schoolId} studentId={studentId} data={recurring.data} /> : null}
          </>
        ) : null}
      </Card>
      {dialog === 'create' && charges.data ? (
        <CreateChargeModal schoolId={schoolId} studentId={studentId} studentName={studentName} data={charges.data} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'recurring' && charges.data ? (
        <CreateRecurringChargeModal schoolId={schoolId} studentId={studentId} studentName={studentName} settings={charges.data.settings} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && typeof dialog === 'object' && charges.data ? (
        <RecordPaymentModal
          schoolId={schoolId}
          studentId={studentId}
          studentName={studentName}
          data={charges.data}
          chargeId={dialog.pay}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {refunding && charges.data ? (
        <RefundModal
          schoolId={schoolId}
          studentId={studentId}
          payment={refunding}
          notesRequired={charges.data.settings.refundNotesRequired}
          onClose={() => setRefunding(null)}
        />
      ) : null}
      {crediting && charges.data?.settings.currency ? (
        <GiveCreditModal
          schoolId={schoolId}
          studentId={studentId}
          studentName={studentName}
          currency={charges.data.settings.currency}
          onClose={() => setCrediting(false)}
        />
      ) : null}
      {cancelling && charges.data ? (
        <CancelChargeModal
          schoolId={schoolId}
          studentId={studentId}
          charge={cancelling}
          reasonRequired={charges.data.settings.cancelReasonRequired}
          onClose={() => setCancelling(null)}
        />
      ) : null}
      {waiving ? <WaiveLateFeeModal schoolId={schoolId} studentId={studentId} charge={waiving} onClose={() => setWaiving(null)} /> : null}
      {cancellingPayment && charges.data ? (
        <CancelPaymentModal
          schoolId={schoolId}
          payment={{ id: cancellingPayment.id, amount: cancellingPayment.amount, currency: cancellingPayment.currency ?? null, planTitle: deskPaymentTitle(t, cancellingPayment) }}
          studentName={studentName}
          reasonRequired={charges.data.settings.cancelReasonRequired}
          onClose={() => setCancellingPayment(null)}
        />
      ) : null}
    </div>
  );
}

/** What a membership's desk payment is for: the plan, a renewal of it, or a
 * freeze fee (the Transactions page's labels). */
function deskPaymentTitle(t: ReturnType<typeof useT>, p: DeskMembershipPayment): string {
  const plan = p.membershipPlanTitle ?? '';
  if (p.kind === 'FREEZE_FEE') return plan ? t('transactions.itemFreezeFee', { plan }) : t('transactions.kindFreezeFee');
  if (p.kind === 'LATE_CANCEL_FEE') return t('transactions.kindLateFee');
  return p.kind === 'RENEWAL' ? t('transactions.itemRenewal', { plan }) : plan;
}

/**
 * Decision 338 item 1 (last point): the student's membership payments by cash
 * or bank transfer waiting at the desk, and the ones cancelled. Shown to the
 * owner and staff with "Can cancel charges" (the API sends none to anyone
 * else); Cancel asks for a reason, as for a charge. Marking one as paid stays
 * on the owner's Transactions page.
 */
function DeskMembershipPayments({
  payments,
  canCancel,
  onCancel,
}: {
  payments: DeskMembershipPayment[];
  canCancel: boolean;
  onCancel: (payment: DeskMembershipPayment) => void;
}) {
  const t = useT();
  return (
    <div data-testid="desk-membership-payments" style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>{t('charges.deskPayments.heading')}</h3>
      <p className="ultm8-field__hint" style={{ margin: '0 0 8px' }}>
        {t('charges.deskPayments.hint')}
      </p>
      <Table<DeskMembershipPayment>
        rows={payments}
        columns={[
          { key: 'billingDate', header: t('transactions.columnDate'), render: (p) => formatDay(p.billingDate.slice(0, 10)) },
          { key: 'plan', header: t('transactions.columnPlan'), render: (p) => deskPaymentTitle(t, p) },
          { key: 'amount', header: t('transactions.columnAmount'), render: (p) => formatMoney(p.amount, p.currency ?? null) },
          {
            key: 'method',
            header: t('transactions.columnMethod'),
            render: (p) => (PAYMENT_METHOD_LABELS[p.paymentMethod] ? t(PAYMENT_METHOD_LABELS[p.paymentMethod]) : p.paymentMethod),
          },
          {
            key: 'status',
            header: t('transactions.columnStatus'),
            render: (p) =>
              p.status === 'CANCELLED' && p.cancelledAt ? (
                <div>
                  {paymentStatusBadge('CANCELLED')}
                  <div className="ultm8-field__hint">
                    {p.cancelReason
                      ? t('charges.card.cancelledLine', { date: formatDay(p.cancelledAt.slice(0, 10)), name: p.cancelledByName ?? '', reason: p.cancelReason })
                      : t('charges.card.cancelledNoReason', { date: formatDay(p.cancelledAt.slice(0, 10)), name: p.cancelledByName ?? '' })}
                  </div>
                </div>
              ) : (
                paymentStatusBadge('PENDING')
              ),
          },
          {
            key: 'actions',
            header: t('transactions.columnActions'),
            render: (p) =>
              p.status === 'PENDING' && canCancel ? (
                <Button variant="danger" onClick={() => onCancel(p)}>
                  {t('transactions.cancelPayment')}
                </Button>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </div>
  );
}

/** "Owes R$ 70,00 · R$ 70,00 overdue", "R$ 30,00 in credit" or "Nothing owed". */
function BalanceLine({ balances }: { balances: ChargeBalance[] }) {
  const t = useT();
  const shown = balances.filter((b) => b.net !== 0);
  if (shown.length === 0) {
    return (
      <p data-testid="charge-balance" style={{ margin: '8px 0 0', fontWeight: 600 }}>
        {t('charges.card.nothingOwed')}
      </p>
    );
  }
  return (
    <p data-testid="charge-balance" style={{ margin: '8px 0 0', fontWeight: 600 }}>
      {shown.map((b, i) => (
        <span key={b.currency}>
          {i > 0 ? ' · ' : null}
          {b.net > 0 ? t('charges.card.owes', { amount: formatMoney(b.net, b.currency) }) : t('charges.card.inCredit', { amount: formatMoney(-b.net, b.currency) })}
          {b.overdue > 0 ? (
            <span style={{ color: 'var(--danger, #C5221F)' }}> · {t('charges.card.overdue', { amount: formatMoney(b.overdue, b.currency) })}</span>
          ) : null}
        </span>
      ))}
    </p>
  );
}

const REFUND_KIND_KEYS: Record<ChargePayment['refunds'][number]['kind'], TranslationKey> = {
  CARD: 'charges.card.refundCard',
  MONEY_BACK: 'charges.card.refundMoneyBack',
  CREDIT: 'charges.card.refundCredit',
  DISPUTE_LOST: 'charges.card.refundDisputeLost',
  STRIPE: 'charges.card.refundStripe',
};

/** Each refund of a payment, with its staff-only notes (step 4). */
function RefundLines({ payment }: { payment: ChargePayment }) {
  const t = useT();
  if (payment.refunds.length === 0) return null;
  return (
    <>
      {payment.refunds.map((r) => (
        <div key={r.id} className="ultm8-field__hint" data-testid="charge-refund-line">
          {t(REFUND_KIND_KEYS[r.kind], { amount: formatMoney(r.amount, payment.currency), date: formatDay(r.refundedAt.slice(0, 10)) })}
          {r.refundedByName ? ` · ${t('charges.card.refundBy', { name: r.refundedByName })}` : null}
          {r.notes ? ` · ${r.notes}` : null}
        </div>
      ))}
    </>
  );
}

function ChargesBody({
  data,
  onPay,
  onCancel,
  onWaive,
  onRefund,
  onResend,
  resending,
}: {
  data: StudentCharges;
  onPay: (chargeId: string) => void;
  onCancel: (charge: Charge) => void;
  onWaive: (charge: Charge) => void;
  onRefund: (payment: ChargePayment) => void;
  onResend: (charge: Charge) => void;
  resending: boolean;
}) {
  const t = useT();
  if (data.charges.length === 0 && data.payments.length === 0 && data.credits.length === 0) {
    return <EmptyState title={t('charges.card.emptyTitle')} description={t('charges.card.emptyDescription')} />;
  }
  const open = (c: Charge) => c.status === 'OPEN' || c.status === 'PART_PAID';
  return (
    <>
      {data.charges.length > 0 ? (
        <>
          <h3 style={{ fontSize: 14, margin: '16px 0 4px' }}>{t('charges.card.chargesHeading')}</h3>
          <Table<Charge>
            rows={data.charges}
            columns={[
              { key: 'invoice', header: t('charges.card.columnInvoice'), render: (c) => c.invoiceLabel },
              {
                key: 'description',
                header: t('charges.card.columnDescription'),
                render: (c) => (
                  <div style={c.status === 'CANCELLED' ? { opacity: 0.6 } : undefined}>
                    <div>
                      {c.lateFee ? <Badge variant="warning">{t('charges.lateFee.badge')}</Badge> : null}
                      {c.promotionFee ? (
                        <>
                          <Badge variant="info">{t('charges.promotionFee.badge')}</Badge>{' '}
                        </>
                      ) : null}
                      {c.lateFee ? null : c.description}
                    </div>
                    <LateFeeLines charge={c} />
                    <PromotionFeeLines charge={c} />
                    {c.discountAmount > 0 ? <div className="ultm8-field__hint">{t('charges.card.discountLine', { amount: formatMoney(c.discountAmount, c.currency) })}</div> : null}
                    {c.status === 'CANCELLED' && c.cancelledAt && c.lateFee?.waived ? (
                      <div className="ultm8-field__hint">{t('charges.lateFee.waivedLine', { date: formatDay(c.cancelledAt.slice(0, 10)), name: c.cancelledByName ?? '' })}</div>
                    ) : c.status === 'CANCELLED' && c.cancelledAt && !c.promotionFee ? (
                      <div className="ultm8-field__hint">
                        {c.cancelReason
                          ? t('charges.card.cancelledLine', { date: formatDay(c.cancelledAt.slice(0, 10)), name: c.cancelledByName ?? '', reason: c.cancelReason })
                          : t('charges.card.cancelledNoReason', { date: formatDay(c.cancelledAt.slice(0, 10)), name: c.cancelledByName ?? '' })}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'due',
                header: t('charges.card.columnDue'),
                render: (c) => <span style={c.overdue ? { color: 'var(--danger, #C5221F)', fontWeight: 600 } : undefined}>{formatDay(c.dueDate)}</span>,
              },
              { key: 'net', header: t('charges.card.columnExTax'), render: (c) => formatMoney(c.netAmount, c.currency) },
              { key: 'tax', header: t('charges.card.columnTax'), render: (c) => `${formatMoney(c.taxAmount, c.currency)} (${rateText(c.taxRateBasisPoints)}%)` },
              { key: 'gross', header: t('charges.card.columnTotal'), render: (c) => formatMoney(c.grossAmount, c.currency) },
              { key: 'owed', header: t('charges.card.columnOwed'), render: (c) => formatMoney(c.owedAmount, c.currency) },
              {
                key: 'status',
                header: t('charges.card.columnStatus'),
                render: (c) => (
                  <>
                    <Badge variant={STATUS_BADGE[c.status]}>{t(`charges.status.${c.status}` as TranslationKey)}</Badge>
                    {c.refundStatus ? (
                      <div className="ultm8-field__hint">
                        {t(`charges.refundStatus.${c.refundStatus}` as TranslationKey)} ({formatMoney(c.refundedAmount, c.currency)})
                      </div>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'actions',
                header: t('charges.card.columnActions'),
                render: (c) => (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {open(c) && data.can.recordPayment && data.settings.paymentsSetUp ? (
                      <Button variant="secondary" onClick={() => onPay(c.id)}>
                        {t('charges.card.pay')}
                      </Button>
                    ) : null}
                    {c.status !== 'CANCELLED' && data.can.resendInvoice ? (
                      <Button variant="secondary" onClick={() => onResend(c)} disabled={resending}>
                        {t('charges.card.resendInvoice')}
                      </Button>
                    ) : null}
                    {!open(c) ? null : c.promotionFee ? (
                      <span className="ultm8-field__hint">{t('charges.promotionFee.cancelHint')}</span>
                    ) : data.can.cancel && c.lateFee ? (
                      <Button variant="danger" onClick={() => onWaive(c)}>
                        {t('charges.lateFee.waive')}
                      </Button>
                    ) : data.can.cancel ? (
                      <Button variant="danger" onClick={() => onCancel(c)}>
                        {t('charges.card.cancel')}
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </>
      ) : null}
      {data.payments.length > 0 ? (
        <>
          <h3 style={{ fontSize: 14, margin: '16px 0 4px' }}>{t('charges.card.paymentsHeading')}</h3>
          <Table<ChargePayment>
            rows={data.payments}
            columns={[
              { key: 'date', header: t('charges.card.columnDate'), render: (p) => formatDay(p.receivedAt.slice(0, 10)) },
              {
                key: 'amount',
                header: t('charges.card.columnAmount'),
                render: (p) => (
                  <>
                    {formatMoney(p.amount, p.currency)}
                    {p.surchargeAmount > 0 ? <div className="ultm8-field__hint">{t('charges.card.surchargeLine', { amount: formatMoney(p.surchargeAmount, p.currency) })}</div> : null}
                    {p.status === 'PENDING' ? <Badge variant="warning">{t('charges.card.paymentPending')}</Badge> : null}
                    {p.status === 'FAILED' ? <Badge variant="danger">{t('charges.card.paymentFailed')}</Badge> : null}
                    {p.status === 'DISPUTED' ? <Badge variant="danger">{t('charges.card.paymentDisputed')}</Badge> : null}
                    {p.refundStatus ? <Badge variant="default">{t(`charges.refundStatus.${p.refundStatus}` as TranslationKey)}</Badge> : null}
                    <RefundLines payment={p} />
                  </>
                ),
              },
              { key: 'method', header: t('charges.card.columnMethod'), render: (p) => paymentMethodText(t, p) },
              {
                key: 'toward',
                header: t('charges.card.columnToward'),
                render: (p) =>
                  p.status === 'PENDING' || p.status === 'FAILED'
                    ? p.invoiceLabel
                      ? t('charges.card.forInvoice', { invoice: p.invoiceLabel })
                      : ''
                    : [
                        ...p.allocations.map((a) => `${a.invoiceLabel} (${formatMoney(a.amount, p.currency)})`),
                        ...(p.creditAmount > 0 ? [t('charges.card.toCredit', { amount: formatMoney(p.creditAmount, p.currency) })] : []),
                      ].join(', '),
              },
              { key: 'by', header: t('charges.card.columnRecordedBy'), render: (p) => p.recordedByName ?? '' },
              ...(data.can.refund
                ? [
                    {
                      key: 'refund',
                      header: t('charges.card.columnActions'),
                      render: (p: ChargePayment) =>
                        p.refundable && (p.refundable.asMoney > 0 || p.refundable.asCredit > 0) ? (
                          <Button variant="secondary" onClick={() => onRefund(p)}>
                            {t('charges.card.refund')}
                          </Button>
                        ) : null,
                    },
                  ]
                : []),
            ]}
          />
        </>
      ) : null}
      {data.credits.length > 0 ? (
        <>
          <h3 style={{ fontSize: 14, margin: '16px 0 4px' }}>{t('charges.card.creditsHeading')}</h3>
          <Table<BalanceCredit>
            rows={data.credits}
            columns={[
              { key: 'date', header: t('charges.card.columnDate'), render: (c) => formatDay(c.givenAt.slice(0, 10)) },
              { key: 'amount', header: t('charges.card.columnAmount'), render: (c) => formatMoney(c.amount, c.currency) },
              { key: 'note', header: t('charges.card.columnNote'), render: (c) => c.note ?? '' },
              { key: 'by', header: t('charges.card.columnGivenBy'), render: (c) => c.givenByName ?? '' },
            ]}
          />
        </>
      ) : null}
      {data.can.recordPayment && !data.settings.paymentsSetUp ? <p className="ultm8-field__hint">{t('charges.card.noPaymentsSetUp')}</p> : null}
    </>
  );
}

function CreateChargeModal({
  schoolId,
  studentId,
  studentName,
  data,
  onClose,
}: {
  schoolId: string;
  studentId: string;
  studentName: string;
  data: StudentCharges;
  onClose: () => void;
}) {
  const t = useT();
  const create = useCreateCharge(schoolId, studentId);
  const { currency, taxRateBasisPoints: rate, taxInclusive } = data.settings;
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<{ minorUnits: number | null; valid: boolean }>({ minorUnits: null, valid: true });
  const [discountType, setDiscountType] = useState<'' | 'PERCENT' | 'FIXED'>('');
  const [percent, setPercent] = useState('');
  const [fixed, setFixed] = useState<{ minorUnits: number | null; valid: boolean }>({ minorUnits: null, valid: true });
  const [dueDate, setDueDate] = useState(today());
  const [error, setError] = useState<string | null>(null);

  const discountValue = discountType === 'PERCENT' ? parseRate(percent) : discountType === 'FIXED' ? fixed.minorUnits : null;
  const preview =
    amount.minorUnits && amount.valid
      ? previewCharge({ amount: amount.minorUnits, discountType: discountType || null, discountValue, taxRateBasisPoints: rate, taxInclusive })
      : null;
  const discountOk = !discountType || (!!discountValue && discountValue > 0 && preview !== null);
  const ready = !!currency && description.trim().length > 0 && !!amount.minorUnits && amount.valid && discountOk && !!dueDate;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    try {
      await create.mutateAsync({
        description: description.trim(),
        amount: amount.minorUnits!,
        discountType: discountType || null,
        discountValue: discountType ? discountValue : null,
        dueDate,
      });
      onClose();
    } catch (err) {
      setError(errorText(err, t('charges.create.failed')));
    }
  }

  return (
    <Modal title={t('charges.create.title', { name: studentName })} onClose={onClose}>
      <form onSubmit={handleSubmit} data-testid="create-charge-form">
        {error ? <ErrorBanner message={error} /> : null}
        {!currency ? <ErrorBanner message={t('charges.create.noCurrency')} /> : null}
        <Field label={t('charges.create.descriptionLabel')} htmlFor="charge-description">
          <TextField
            id="charge-description"
            maxLength={200}
            placeholder={t('charges.create.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </Field>
        <Field
          label={t('charges.create.amountLabel')}
          htmlFor="charge-amount"
          hint={taxInclusive ? t('charges.create.amountHintInclusive', { rate: rateText(rate) }) : t('charges.create.amountHintOnTop', { rate: rateText(rate) })}
          error={amount.valid ? undefined : t('charges.create.amountInvalid')}
        >
          <MoneyField id="charge-amount" value={amount.minorUnits} currency={currency} onChange={(minorUnits, valid) => setAmount({ minorUnits, valid })} />
        </Field>
        <Field label={t('charges.create.discountLabel')} htmlFor="charge-discount-type">
          <SelectField
            id="charge-discount-type"
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as '' | 'PERCENT' | 'FIXED')}
            options={[
              { value: '', label: t('charges.create.discountNone') },
              { value: 'PERCENT', label: t('charges.create.discountPercent') },
              { value: 'FIXED', label: t('charges.create.discountFixed') },
            ]}
          />
        </Field>
        {discountType ? (
          <Field
            label={t('charges.create.discountValueLabel')}
            htmlFor="charge-discount-value"
            error={discountOk || (discountType === 'PERCENT' ? !percent : !fixed.minorUnits) ? undefined : t('charges.create.discountInvalid')}
          >
            {discountType === 'PERCENT' ? (
              <TextField id="charge-discount-value" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
            ) : (
              <MoneyField id="charge-discount-value" value={fixed.minorUnits} currency={currency} onChange={(minorUnits, valid) => setFixed({ minorUnits, valid })} />
            )}
          </Field>
        ) : null}
        <Field label={t('charges.create.dueLabel')} htmlFor="charge-due">
          <TextField id="charge-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </Field>
        {preview && currency ? (
          <dl data-testid="charge-preview" style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '4px 16px', margin: '8px 0 16px' }}>
            <dt>{t('charges.create.previewExTax')}</dt>
            <dd style={{ margin: 0 }}>{formatMoney(preview.net, currency)}</dd>
            <dt>{t('charges.create.previewTax', { rate: rateText(rate) })}</dt>
            <dd style={{ margin: 0 }}>{formatMoney(preview.tax, currency)}</dd>
            <dt style={{ fontWeight: 600 }}>{t('charges.create.previewIncTax')}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{formatMoney(preview.gross, currency)}</dd>
          </dl>
        ) : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" loading={create.isPending} disabled={!ready}>
            {t('charges.create.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RecordPaymentModal({
  schoolId,
  studentId,
  studentName,
  data,
  chargeId,
  onClose,
}: {
  schoolId: string;
  studentId: string;
  studentName: string;
  data: StudentCharges;
  chargeId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const record = useRecordChargePayment(schoolId, studentId);
  const open = data.charges.filter((c) => c.status === 'OPEN' || c.status === 'PART_PAID');
  const [toward, setToward] = useState(chargeId ?? '');
  const target = open.find((c) => c.id === toward);
  const [amount, setAmount] = useState<{ minorUnits: number | null; valid: boolean }>({ minorUnits: target?.owedAmount ?? null, valid: true });
  const [method, setMethod] = useState<(typeof CHARGE_PAYMENT_METHODS)[number]>('CASH');
  const [sendReceipt, setSendReceipt] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currency = target?.currency ?? data.settings.currency;
  const ready = !!amount.minorUnits && amount.valid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    try {
      await record.mutateAsync({ chargeId: toward || null, amount: amount.minorUnits!, paymentMethod: method, sendReceipt });
      onClose();
    } catch (err) {
      setError(errorText(err, t('charges.pay.failed')));
    }
  }

  return (
    <Modal title={t('charges.pay.title', { name: studentName })} onClose={onClose}>
      <form onSubmit={handleSubmit} data-testid="record-charge-payment-form">
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('charges.pay.towardLabel')} htmlFor="charge-pay-toward">
          <SelectField
            id="charge-pay-toward"
            value={toward}
            onChange={(e) => {
              setToward(e.target.value);
              const next = open.find((c) => c.id === e.target.value);
              if (next) setAmount({ minorUnits: next.owedAmount, valid: true });
            }}
            options={[
              { value: '', label: t('charges.pay.towardBalance') },
              ...open.map((c) => ({
                value: c.id,
                label: t('charges.pay.towardCharge', { invoice: c.invoiceLabel, description: chargeTitle(t, c), owed: formatMoney(c.owedAmount, c.currency) }),
              })),
            ]}
          />
        </Field>
        <Field label={t('charges.pay.amountLabel')} htmlFor="charge-pay-amount" hint={t('charges.pay.amountHint')} error={amount.valid ? undefined : t('charges.create.amountInvalid')}>
          <MoneyField id="charge-pay-amount" value={amount.minorUnits} currency={currency} onChange={(minorUnits, valid) => setAmount({ minorUnits, valid })} />
        </Field>
        <Field label={t('charges.pay.methodLabel')} htmlFor="charge-pay-method">
          <SelectField
            id="charge-pay-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as (typeof CHARGE_PAYMENT_METHODS)[number])}
            options={CHARGE_PAYMENT_METHODS.map((m) => ({ value: m, label: t(PAYMENT_METHOD_LABELS[m]) }))}
          />
        </Field>
        {data.settings.receiptNotice ? (
          <>
            <Checkbox label={t('charges.pay.sendReceipt')} checked={sendReceipt} onChange={(e) => setSendReceipt(e.target.checked)} />
            <p className="ultm8-field__hint" style={{ marginTop: 4 }}>
              {t('charges.pay.sendReceiptHint')}
            </p>
          </>
        ) : (
          <p className="ultm8-field__hint">{t('charges.pay.receiptsOff')}</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button type="submit" loading={record.isPending} disabled={!ready}>
            {t('charges.pay.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CancelChargeModal({
  schoolId,
  studentId,
  charge,
  reasonRequired,
  onClose,
}: {
  schoolId: string;
  studentId: string;
  charge: Charge;
  reasonRequired: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const cancel = useCancelCharge(schoolId, studentId);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const missing = reasonRequired && reason.trim().length === 0;

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (missing) {
      setError(t('charges.cancelDialog.reasonRequired'));
      return;
    }
    setError(null);
    try {
      await cancel.mutateAsync({ chargeId: charge.id, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(errorText(err, t('charges.cancelDialog.failed')));
    }
  }

  return (
    <Modal title={t('charges.cancelDialog.title', { invoice: charge.invoiceLabel })} onClose={onClose}>
      <form onSubmit={confirm} data-testid="cancel-charge-form">
        <p>{t('charges.cancelDialog.body', { description: charge.description, amount: formatMoney(charge.grossAmount, charge.currency) })}</p>
        {charge.paidAmount > 0 ? <p>{t('charges.cancelDialog.paidNote', { amount: formatMoney(charge.paidAmount, charge.currency) })}</p> : null}
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={reasonRequired ? t('charges.cancelDialog.reasonLabel') : t('charges.cancelDialog.reasonOptional')} htmlFor="charge-cancel-reason">
          <TextArea id="charge-cancel-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" variant="danger" loading={cancel.isPending}>
            {t('charges.cancelDialog.confirm')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('charges.cancelDialog.keep')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Decision 413: waiving a late fee cancels it, with no reason asked for; the member is told. */
function WaiveLateFeeModal({ schoolId, studentId, charge, onClose }: { schoolId: string; studentId: string; charge: Charge; onClose: () => void }) {
  const t = useT();
  const waive = useWaiveLateFee(schoolId, studentId);
  const [error, setError] = useState<string | null>(null);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await waive.mutateAsync(charge.id);
      onClose();
    } catch (err) {
      setError(errorText(err, t('charges.lateFee.waiveFailed')));
    }
  }

  return (
    <Modal title={t('charges.lateFee.waiveTitle', { invoice: charge.invoiceLabel })} onClose={onClose}>
      <form onSubmit={confirm} data-testid="waive-late-fee-form">
        <p>{t('charges.lateFee.waiveBody', { amount: formatMoney(charge.grossAmount, charge.currency) })}</p>
        <LateFeeLines charge={charge} />
        {charge.paidAmount > 0 ? <p>{t('charges.lateFee.waivePaidNote', { amount: formatMoney(charge.paidAmount, charge.currency) })}</p> : null}
        {error ? <ErrorBanner message={error} /> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button type="submit" variant="danger" loading={waive.isPending}>
            {t('charges.lateFee.waiveConfirm')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('charges.lateFee.waiveKeep')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Step 4 (Decision 338 item 3): the owner refunds a payment, choosing each
 * time where the money goes. A card payment goes back to the card or becomes
 * credit; a desk payment is given back (records only) or becomes credit. */
function RefundModal({
  schoolId,
  studentId,
  payment,
  notesRequired,
  onClose,
}: {
  schoolId: string;
  studentId: string;
  payment: ChargePayment;
  notesRequired: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const refund = useRefundChargePayment(schoolId, studentId);
  const card = payment.paymentMethod === 'STRIPE';
  const asMoney = payment.refundable?.asMoney ?? 0;
  const asCredit = payment.refundable?.asCredit ?? 0;
  const [destination, setDestination] = useState<'CARD' | 'MONEY_BACK' | 'CREDIT'>(asMoney > 0 ? (card ? 'CARD' : 'MONEY_BACK') : 'CREDIT');
  const max = destination === 'CREDIT' ? asCredit : asMoney;
  const [amount, setAmount] = useState<{ minorUnits: number | null; valid: boolean }>({ minorUnits: max, valid: true });
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tooMuch = !!amount.minorUnits && amount.minorUnits > max;
  const ready = !!amount.minorUnits && amount.valid && !tooMuch && (!notesRequired || notes.trim().length > 0);

  function choose(next: 'CARD' | 'MONEY_BACK' | 'CREDIT') {
    setDestination(next);
    setAmount({ minorUnits: next === 'CREDIT' ? asCredit : asMoney, valid: true });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (notesRequired && notes.trim().length === 0) {
      setError(t('charges.refundDialog.notesRequired'));
      return;
    }
    if (!ready) return;
    setError(null);
    try {
      await refund.mutateAsync({ transactionId: payment.id, amount: amount.minorUnits!, destination, ...(notes.trim() ? { notes: notes.trim() } : {}) });
      onClose();
    } catch (err) {
      setError(errorText(err, t('charges.refundDialog.failed')));
    }
  }

  const options = [
    ...(asMoney > 0 ? [card ? { value: 'CARD', label: t('charges.refundDialog.toCard') } : { value: 'MONEY_BACK', label: t('charges.refundDialog.moneyBack') }] : []),
    ...(asCredit > 0 ? [{ value: 'CREDIT', label: t('charges.refundDialog.asCredit') }] : []),
  ];

  return (
    <Modal title={t('charges.refundDialog.title', { amount: formatMoney(payment.amount, payment.currency) })} onClose={onClose}>
      <form onSubmit={handleSubmit} data-testid="refund-charge-payment-form">
        <p>{t('charges.refundDialog.paidLine', { amount: formatMoney(payment.amount, payment.currency), date: formatDay(payment.receivedAt.slice(0, 10)) })}</p>
        {payment.refundedAmount > 0 ? <p>{t('charges.refundDialog.alreadyRefunded', { amount: formatMoney(payment.refundedAmount, payment.currency) })}</p> : null}
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('charges.refundDialog.destinationLabel')} htmlFor="charge-refund-destination">
          <SelectField id="charge-refund-destination" value={destination} onChange={(e) => choose(e.target.value as 'CARD' | 'MONEY_BACK' | 'CREDIT')} options={options} />
        </Field>
        {destination === 'MONEY_BACK' ? <p className="ultm8-field__hint">{t('charges.refundDialog.moneyBackHint')}</p> : null}
        {destination === 'CREDIT' ? <p className="ultm8-field__hint">{t('charges.refundDialog.asCreditHint')}</p> : null}
        <Field
          label={t('charges.refundDialog.amountLabel')}
          htmlFor="charge-refund-amount"
          hint={t('charges.refundDialog.amountHint', { amount: formatMoney(max, payment.currency) })}
          error={!amount.valid ? t('charges.create.amountInvalid') : tooMuch ? t('charges.refundDialog.tooMuch', { amount: formatMoney(max, payment.currency) }) : undefined}
        >
          <MoneyField id="charge-refund-amount" value={amount.minorUnits} currency={payment.currency} onChange={(minorUnits, valid) => setAmount({ minorUnits, valid })} />
        </Field>
        {payment.surchargeAmount > 0 ? <p className="ultm8-field__hint">{t('charges.refundDialog.surchargeNote')}</p> : null}
        <Field label={notesRequired ? t('charges.refundDialog.notesLabel') : t('charges.refundDialog.notesOptional')} htmlFor="charge-refund-notes">
          <TextArea id="charge-refund-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" variant="danger" loading={refund.isPending} disabled={!ready}>
            {t('charges.refundDialog.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Step 4: credit the owner gives (goodwill, say), with a staff-only note. */
function GiveCreditModal({
  schoolId,
  studentId,
  studentName,
  currency,
  onClose,
}: {
  schoolId: string;
  studentId: string;
  studentName: string;
  currency: string;
  onClose: () => void;
}) {
  const t = useT();
  const give = useGiveCredit(schoolId, studentId);
  const [amount, setAmount] = useState<{ minorUnits: number | null; valid: boolean }>({ minorUnits: null, valid: true });
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ready = !!amount.minorUnits && amount.valid && note.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (note.trim().length === 0) {
      setError(t('charges.creditDialog.noteRequired'));
      return;
    }
    if (!ready) return;
    setError(null);
    try {
      await give.mutateAsync({ amount: amount.minorUnits!, note: note.trim() });
      onClose();
    } catch (err) {
      setError(errorText(err, t('charges.creditDialog.failed')));
    }
  }

  return (
    <Modal title={t('charges.creditDialog.title', { name: studentName })} onClose={onClose}>
      <form onSubmit={handleSubmit} data-testid="give-credit-form">
        <p className="ultm8-field__hint">{t('charges.creditDialog.hint')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('charges.creditDialog.amountLabel')} htmlFor="charge-credit-amount" error={amount.valid ? undefined : t('charges.create.amountInvalid')}>
          <MoneyField id="charge-credit-amount" value={amount.minorUnits} currency={currency} onChange={(minorUnits, valid) => setAmount({ minorUnits, valid })} />
        </Field>
        <Field label={t('charges.creditDialog.noteLabel')} htmlFor="charge-credit-note">
          <TextArea id="charge-credit-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" loading={give.isPending} disabled={!ready}>
            {t('charges.creditDialog.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
