import React, { useState } from 'react';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Modal, SelectField, Spinner, Table, TextArea, TextField } from '@ultm8/ui';
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
  useRecordChargePayment,
  useStudentCharges,
  type Charge,
  type ChargeBalance,
  type ChargePayment,
  type StudentCharges,
} from './chargeQueries';

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
  const [dialog, setDialog] = useState<'create' | { pay: string | null } | null>(null);
  const [cancelling, setCancelling] = useState<Charge | null>(null);

  if (charges.error instanceof ApiError && charges.error.status === 403) return null;

  return (
    <div style={{ marginBottom: 24 }}>
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
              {charges.data.can.recordPayment ? (
                <Button variant="secondary" onClick={() => setDialog({ pay: null })} disabled={!charges.data.settings.paymentsSetUp}>
                  {t('charges.card.recordPayment')}
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
          <ChargesBody data={charges.data} onPay={(id) => setDialog({ pay: id })} onCancel={setCancelling} />
        ) : null}
      </Card>
      {dialog === 'create' && charges.data ? (
        <CreateChargeModal schoolId={schoolId} studentId={studentId} studentName={studentName} data={charges.data} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && dialog !== 'create' && charges.data ? (
        <RecordPaymentModal
          schoolId={schoolId}
          studentId={studentId}
          studentName={studentName}
          data={charges.data}
          chargeId={dialog.pay}
          onClose={() => setDialog(null)}
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

function ChargesBody({ data, onPay, onCancel }: { data: StudentCharges; onPay: (chargeId: string) => void; onCancel: (charge: Charge) => void }) {
  const t = useT();
  if (data.charges.length === 0 && data.payments.length === 0) {
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
                    <div>{c.description}</div>
                    {c.discountAmount > 0 ? <div className="ultm8-field__hint">{t('charges.card.discountLine', { amount: formatMoney(c.discountAmount, c.currency) })}</div> : null}
                    {c.status === 'CANCELLED' && c.cancelledAt ? (
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
              { key: 'status', header: t('charges.card.columnStatus'), render: (c) => <Badge variant={STATUS_BADGE[c.status]}>{t(`charges.status.${c.status}` as TranslationKey)}</Badge> },
              {
                key: 'actions',
                header: t('charges.card.columnActions'),
                render: (c) =>
                  open(c) ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      {data.can.recordPayment && data.settings.paymentsSetUp ? (
                        <Button variant="secondary" onClick={() => onPay(c.id)}>
                          {t('charges.card.pay')}
                        </Button>
                      ) : null}
                      {data.can.cancel ? (
                        <Button variant="danger" onClick={() => onCancel(c)}>
                          {t('charges.card.cancel')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null,
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
                label: t('charges.pay.towardCharge', { invoice: c.invoiceLabel, description: c.description, owed: formatMoney(c.owedAmount, c.currency) }),
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
        <Checkbox label={t('charges.pay.sendReceipt')} checked={sendReceipt} onChange={(e) => setSendReceipt(e.target.checked)} />
        <p className="ultm8-field__hint" style={{ marginTop: 4 }}>
          {t('charges.pay.sendReceiptHint')}
        </p>
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
