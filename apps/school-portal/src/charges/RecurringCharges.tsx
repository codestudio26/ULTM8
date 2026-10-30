import React, { useState } from 'react';
import { Badge, Button, ErrorBanner, Field, Modal, SelectField, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { formatMoney } from '../lib/money';
import { MoneyField } from '../lib/MoneyField';
import { NoTaxCheckbox, PreviewTaxRow } from './NoTaxFields';
import {
  parseRate,
  previewCharge,
  rateText,
  useCreateRecurringCharge,
  useRestartRecurringCharge,
  useStopRecurringCharge,
  type RecurringCharge,
  type StudentCharges,
  type StudentRecurringCharges,
} from './chargeQueries';

const STATUS_BADGE: Record<RecurringCharge['status'], 'success' | 'default' | 'info'> = { ACTIVE: 'success', STOPPED: 'default', ENDED: 'info' };
const FREQUENCIES = ['WEEKLY', 'MONTHLY', 'YEARLY'] as const;
/** The API's limit on a number of payments (MAX_RECURRING_OCCURRENCES). */
const MAX_PAYMENTS = 520;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * The student's recurring charges on the Payments card (Decision 412;
 * backlog §3.6 step 3): what, how much each time, how often, the next date,
 * when it ends, and Stop or Restart for those who may. Each occurrence shows
 * in the charges list above as a normal charge once it is made.
 */
export function RecurringChargesList({ schoolId, studentId, data }: { schoolId: string; studentId: string; data: StudentRecurringCharges }) {
  const t = useT();
  const restart = useRestartRecurringCharge(schoolId, studentId);
  const [stopping, setStopping] = useState<RecurringCharge | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (data.items.length === 0) return null;

  async function onRestart(r: RecurringCharge) {
    setError(null);
    try {
      await restart.mutateAsync(r.id);
    } catch (err) {
      setError(errorText(err, t('charges.recurring.restartFailed')));
    }
  }

  const ends = (r: RecurringCharge) =>
    r.endDate
      ? t('charges.recurring.endsOn', { date: formatDay(r.endDate) })
      : r.maxOccurrences
        ? t('charges.recurring.endsCount', { done: r.createdCount, count: r.maxOccurrences })
        : t('charges.recurring.endsNever');

  return (
    <div data-testid="recurring-charges">
      <h3 style={{ fontSize: 14, margin: '16px 0 4px' }}>{t('charges.recurring.heading')}</h3>
      {error ? <ErrorBanner message={error} /> : null}
      <Table<RecurringCharge>
        rows={data.items}
        columns={[
          {
            key: 'description',
            header: t('charges.recurring.columnDescription'),
            render: (r) => (
              <div style={r.status === 'ACTIVE' ? undefined : { opacity: 0.6 }}>
                <div>{r.description}</div>
                {r.status === 'STOPPED' && r.stoppedAt ? (
                  <div className="ultm8-field__hint">
                    {r.stoppedReason === 'STUDENT_LEFT'
                      ? t('charges.recurring.stoppedLeft', { date: formatDay(r.stoppedAt.slice(0, 10)) })
                      : t('charges.recurring.stoppedBy', { date: formatDay(r.stoppedAt.slice(0, 10)), name: r.stoppedByName ?? '' })}
                  </div>
                ) : null}
              </div>
            ),
          },
          {
            key: 'amount',
            header: t('charges.recurring.columnAmount'),
            render: (r) => (
              <>
                {formatMoney(r.estimate.grossAmount, r.currency)}
                <div className="ultm8-field__hint">
                  {r.taxExempt ? t('charges.create.noTaxLabel') : t('charges.recurring.taxNote', { rate: rateText(r.estimate.taxRateBasisPoints) })}
                </div>
              </>
            ),
          },
          { key: 'every', header: t('charges.recurring.columnEvery'), render: (r) => t(`charges.recurring.every.${r.frequency}` as TranslationKey) },
          { key: 'next', header: t('charges.recurring.columnNext'), render: (r) => (r.nextDate ? formatDay(r.nextDate) : '') },
          { key: 'ends', header: t('charges.recurring.columnEnds'), render: ends },
          {
            key: 'status',
            header: t('charges.recurring.columnStatus'),
            render: (r) => <Badge variant={STATUS_BADGE[r.status]}>{t(`charges.recurring.status.${r.status}` as TranslationKey)}</Badge>,
          },
          {
            key: 'actions',
            header: t('charges.recurring.columnActions'),
            render: (r) =>
              r.status === 'ACTIVE' && data.can.stop ? (
                <Button variant="danger" onClick={() => setStopping(r)}>
                  {t('charges.recurring.stop')}
                </Button>
              ) : r.status === 'STOPPED' && data.can.restart ? (
                <Button variant="secondary" loading={restart.isPending && restart.variables === r.id} onClick={() => void onRestart(r)}>
                  {t('charges.recurring.restart')}
                </Button>
              ) : null,
          },
        ]}
      />
      {stopping ? <StopRecurringModal schoolId={schoolId} studentId={studentId} series={stopping} onClose={() => setStopping(null)} /> : null}
    </div>
  );
}

function StopRecurringModal({ schoolId, studentId, series, onClose }: { schoolId: string; studentId: string; series: RecurringCharge; onClose: () => void }) {
  const t = useT();
  const stop = useStopRecurringCharge(schoolId, studentId);
  const [error, setError] = useState<string | null>(null);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await stop.mutateAsync(series.id);
      onClose();
    } catch (err) {
      setError(errorText(err, t('charges.recurring.stopDialog.failed')));
    }
  }

  return (
    <Modal title={t('charges.recurring.stopDialog.title', { description: series.description })} onClose={onClose}>
      <form onSubmit={confirm} data-testid="stop-recurring-charge-form">
        <p>{t('charges.recurring.stopDialog.body')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" variant="danger" loading={stop.isPending}>
            {t('charges.recurring.stopDialog.confirm')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('charges.recurring.stopDialog.keep')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type EndKind = 'NEVER' | 'DATE' | 'COUNT';

/** "+ Recurring charge": description, price, discount, how often, first date,
 * and an optional end date or number of payments (Decision 412). */
export function CreateRecurringChargeModal({
  schoolId,
  studentId,
  studentName,
  settings,
  onClose,
}: {
  schoolId: string;
  studentId: string;
  studentName: string;
  settings: StudentCharges['settings'];
  onClose: () => void;
}) {
  const t = useT();
  const create = useCreateRecurringCharge(schoolId, studentId);
  const { currency, taxRateBasisPoints: rate, taxInclusive } = settings;
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<{ minorUnits: number | null; valid: boolean }>({ minorUnits: null, valid: true });
  const [discountType, setDiscountType] = useState<'' | 'PERCENT' | 'FIXED'>('');
  const [percent, setPercent] = useState('');
  const [fixed, setFixed] = useState<{ minorUnits: number | null; valid: boolean }>({ minorUnits: null, valid: true });
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>('MONTHLY');
  const [firstDate, setFirstDate] = useState(today());
  const [endKind, setEndKind] = useState<EndKind>('NEVER');
  const [endDate, setEndDate] = useState('');
  const [count, setCount] = useState('');
  // Decision 414 item 5: "No tax on this item (0% or exempt)", off by default.
  const [taxExempt, setTaxExempt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discountValue = discountType === 'PERCENT' ? parseRate(percent) : discountType === 'FIXED' ? fixed.minorUnits : null;
  const preview =
    amount.minorUnits && amount.valid
      ? previewCharge({ amount: amount.minorUnits, discountType: discountType || null, discountValue, taxRateBasisPoints: taxExempt ? 0 : rate, taxInclusive })
      : null;
  const discountOk = !discountType || (!!discountValue && discountValue > 0 && preview !== null);
  const countNumber = /^\d+$/.test(count.trim()) ? Number(count.trim()) : NaN;
  const countOk = endKind !== 'COUNT' || (countNumber >= 1 && countNumber <= MAX_PAYMENTS);
  const endDateOk = endKind !== 'DATE' || (!!endDate && endDate >= firstDate);
  const ready = !!currency && description.trim().length > 0 && !!amount.minorUnits && amount.valid && discountOk && !!firstDate && countOk && endDateOk;

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
        frequency,
        firstDate,
        endDate: endKind === 'DATE' ? endDate : null,
        maxOccurrences: endKind === 'COUNT' ? countNumber : null,
        taxExempt,
      });
      onClose();
    } catch (err) {
      setError(errorText(err, t('charges.recurring.create.failed')));
    }
  }

  return (
    <Modal title={t('charges.recurring.create.title', { name: studentName })} onClose={onClose}>
      <form onSubmit={handleSubmit} data-testid="create-recurring-charge-form">
        {error ? <ErrorBanner message={error} /> : null}
        {!currency ? <ErrorBanner message={t('charges.create.noCurrency')} /> : null}
        <Field label={t('charges.create.descriptionLabel')} htmlFor="recurring-description">
          <TextField id="recurring-description" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} required />
        </Field>
        <Field
          label={t('charges.create.amountLabel')}
          htmlFor="recurring-amount"
          hint={
            taxExempt
              ? t('charges.create.amountHintNoTax')
              : taxInclusive
                ? t('charges.create.amountHintInclusive', { rate: rateText(rate) })
                : t('charges.create.amountHintOnTop', { rate: rateText(rate) })
          }
          error={amount.valid ? undefined : t('charges.create.amountInvalid')}
        >
          <MoneyField id="recurring-amount" value={amount.minorUnits} currency={currency} onChange={(minorUnits, valid) => setAmount({ minorUnits, valid })} />
        </Field>
        <Field label={t('charges.create.discountLabel')} htmlFor="recurring-discount-type">
          <SelectField
            id="recurring-discount-type"
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
            htmlFor="recurring-discount-value"
            error={discountOk || (discountType === 'PERCENT' ? !percent : !fixed.minorUnits) ? undefined : t('charges.create.discountInvalid')}
          >
            {discountType === 'PERCENT' ? (
              <TextField id="recurring-discount-value" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
            ) : (
              <MoneyField id="recurring-discount-value" value={fixed.minorUnits} currency={currency} onChange={(minorUnits, valid) => setFixed({ minorUnits, valid })} />
            )}
          </Field>
        ) : null}
        <Field label={t('charges.recurring.create.frequencyLabel')} htmlFor="recurring-frequency">
          <SelectField
            id="recurring-frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as (typeof FREQUENCIES)[number])}
            options={FREQUENCIES.map((f) => ({ value: f, label: t(`charges.recurring.every.${f}` as TranslationKey) }))}
          />
        </Field>
        <Field label={t('charges.recurring.create.firstLabel')} htmlFor="recurring-first" hint={t('charges.recurring.create.firstHint')}>
          <TextField id="recurring-first" type="date" min={today()} value={firstDate} onChange={(e) => setFirstDate(e.target.value)} required />
        </Field>
        <Field label={t('charges.recurring.create.endLabel')} htmlFor="recurring-end">
          <SelectField
            id="recurring-end"
            value={endKind}
            onChange={(e) => setEndKind(e.target.value as EndKind)}
            options={[
              { value: 'NEVER', label: t('charges.recurring.create.endNever') },
              { value: 'DATE', label: t('charges.recurring.create.endOnDate') },
              { value: 'COUNT', label: t('charges.recurring.create.endAfterCount') },
            ]}
          />
        </Field>
        {endKind === 'DATE' ? (
          <Field
            label={t('charges.recurring.create.endDateLabel')}
            htmlFor="recurring-end-date"
            error={endDate && !endDateOk ? t('charges.recurring.create.endBeforeFirst') : undefined}
          >
            <TextField id="recurring-end-date" type="date" min={firstDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </Field>
        ) : null}
        {endKind === 'COUNT' ? (
          <Field label={t('charges.recurring.create.countLabel')} htmlFor="recurring-count" error={count && !countOk ? t('charges.recurring.create.countInvalid') : undefined}>
            <TextField id="recurring-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} required />
          </Field>
        ) : null}
        <NoTaxCheckbox id="recurring-no-tax" checked={taxExempt} onChange={setTaxExempt} />
        {preview && currency ? (
          <dl data-testid="recurring-charge-preview" style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '4px 16px', margin: '8px 0 4px' }}>
            <dt>{t('charges.create.previewExTax')}</dt>
            <dd style={{ margin: 0 }}>{formatMoney(preview.net, currency)}</dd>
            <PreviewTaxRow taxExempt={taxExempt} rate={rate} tax={preview.tax} currency={currency} />
            <dt style={{ fontWeight: 600 }}>{t('charges.recurring.create.previewEach')}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{formatMoney(preview.gross, currency)}</dd>
          </dl>
        ) : null}
        <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
          {taxExempt ? t('charges.recurring.create.noteNoTax') : t('charges.recurring.create.note')}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" loading={create.isPending} disabled={!ready}>
            {t('charges.recurring.create.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
