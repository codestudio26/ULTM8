import React from 'react';
import { Checkbox, Field, SelectField, TextField } from '@ultm8/ui';
import type { components } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { parseMoney, toText } from '../lib/MoneyField';
import { CurrencyFirstNotice } from '../lib/CurrencyFirstNotice';

type School = components['schemas']['SchoolResponseDto'];

/** Decisions 291/292 — the six "Class cancellations" settings, shared by the
 * School page and each Branch's settings page (same columns on both). */
export type CancellationSettings = Pick<
  School,
  | 'classCancellationPolicy'
  | 'classCancellationPolicyWindow'
  | 'chargeLateCancellationFee'
  | 'schoolCancelledClassResolution'
  | 'defaultRefundCutoffHours'
  | 'noShowFee'
>;

/** The form's own shape: the two optional numbers as text, so a blank box means
 * "none". The no-show fee is typed in normal units ("10.50"), not hundredths
 * (School Settings review, S3 — "10" used to mean 0.10). */
export type CancellationSettingsForm = Omit<CancellationSettings, 'defaultRefundCutoffHours' | 'noShowFee'> & {
  defaultRefundCutoffHours: string;
  noShowFee: string;
};

export function cancellationSettingsForm(source: CancellationSettings): CancellationSettingsForm {
  return {
    classCancellationPolicy: source.classCancellationPolicy,
    classCancellationPolicyWindow: source.classCancellationPolicyWindow,
    chargeLateCancellationFee: source.chargeLateCancellationFee,
    schoolCancelledClassResolution: source.schoolCancelledClassResolution,
    defaultRefundCutoffHours: source.defaultRefundCutoffHours?.toString() ?? '',
    noShowFee: toText(source.noShowFee ?? null),
  };
}

/** False while the no-show fee box holds something that isn't an amount. */
export function isCancellationSettingsValid(form: CancellationSettingsForm): boolean {
  return parseMoney(form.noShowFee).valid;
}

export function cancellationSettingsPayload(form: CancellationSettingsForm) {
  return {
    classCancellationPolicy: form.classCancellationPolicy,
    classCancellationPolicyWindow: form.classCancellationPolicyWindow,
    chargeLateCancellationFee: form.chargeLateCancellationFee,
    schoolCancelledClassResolution: form.schoolCancelledClassResolution,
    defaultRefundCutoffHours: form.defaultRefundCutoffHours === '' ? null : Number(form.defaultRefundCutoffHours),
    noShowFee: parseMoney(form.noShowFee).minorUnits || null,
  };
}

export function CancellationSettingsFields({
  form,
  onChange,
  disabled = false,
  currency,
  schoolCurrencyMissing = false,
}: {
  form: CancellationSettingsForm;
  onChange: (next: CancellationSettingsForm) => void;
  disabled?: boolean;
  /** Shown after the no-show fee box, e.g. "BRL". */
  currency?: string | null;
  /** Decision 414 item 6: the School has no currency yet, so the no-show fee
   * (a price) is off, with a notice linking to the School page setting. */
  schoolCurrencyMissing?: boolean;
}) {
  const t = useT();
  function set<K extends keyof CancellationSettingsForm>(key: K, value: CancellationSettingsForm[K]) {
    onChange({ ...form, [key]: value });
  }

  return (
    <>
      <Field label={t('schools.form.cancellationPolicy')} htmlFor="cancel-policy" hint={t(`schools.cancellations.policyHint.${form.classCancellationPolicy}`)}>
        <SelectField
          id="cancel-policy"
          disabled={disabled}
          value={form.classCancellationPolicy}
          onChange={(e) => set('classCancellationPolicy', e.target.value as CancellationSettingsForm['classCancellationPolicy'])}
          options={[
            { value: 'MANUAL', label: t('schools.form.policyManual') },
            { value: 'AUTO_REFUND', label: t('schools.form.policyAutoRefund') },
            { value: 'AUTO_CREDIT', label: t('schools.form.policyAutoCredit') },
          ]}
        />
      </Field>
      <Field label={t('schools.cancellations.windowLabel')} htmlFor="cancel-window">
        <SelectField
          id="cancel-window"
          disabled={disabled}
          value={form.classCancellationPolicyWindow}
          onChange={(e) => set('classCancellationPolicyWindow', e.target.value as CancellationSettingsForm['classCancellationPolicyWindow'])}
          options={[
            { value: 'BEFORE_CUTOFF', label: t('schools.cancellations.windowBeforeCutoff') },
            { value: 'ANY_TIME', label: t('schools.cancellations.windowAnyTime') },
          ]}
        />
      </Field>
      <Field label={t('schools.cancellations.defaultCutoffLabel')} htmlFor="cancel-default-cutoff" hint={t('schools.cancellations.defaultCutoffHint')}>
        <TextField
          id="cancel-default-cutoff"
          type="number"
          min={0}
          disabled={disabled}
          value={form.defaultRefundCutoffHours}
          onChange={(e) => set('defaultRefundCutoffHours', e.target.value)}
        />
      </Field>
      <Checkbox
        label={t('schools.cancellations.lateFeeLabel')}
        disabled={disabled}
        checked={form.chargeLateCancellationFee}
        onChange={(e) => set('chargeLateCancellationFee', e.target.checked)}
      />
      {schoolCurrencyMissing && !disabled ? <CurrencyFirstNotice /> : null}
      <Field
        label={t('schools.cancellations.noShowFeeLabel')}
        htmlFor="cancel-no-show-fee"
        hint={t('schools.cancellations.noShowFeeHint')}
        error={parseMoney(form.noShowFee).valid ? undefined : t('schools.cancellations.noShowFeeInvalid')}
      >
        <AmountInput value={form.noShowFee} onChange={(v) => set('noShowFee', v)} currency={currency} disabled={disabled || schoolCurrencyMissing} />
      </Field>
      <Field label={t('schools.cancellations.classCancelledLabel')} htmlFor="cancel-class-resolution">
        <SelectField
          id="cancel-class-resolution"
          disabled={disabled}
          value={form.schoolCancelledClassResolution}
          onChange={(e) => set('schoolCancelledClassResolution', e.target.value as CancellationSettingsForm['schoolCancelledClassResolution'])}
          options={[
            { value: 'REFUND_ALL', label: t('schools.cancellations.classCancelledRefund') },
            { value: 'CREDIT_ALL', label: t('schools.cancellations.classCancelledCredit') },
            { value: 'FOLLOW_POLICY', label: t('schools.cancellations.classCancelledFollow') },
          ]}
        />
      </Field>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 0' }}>{t('schools.cancellations.fixedRules')}</p>
    </>
  );
}

/** A money amount typed as text, with the currency after it. `Field` hands it
 * the input's id and aria props. */
function AmountInput({
  value,
  onChange,
  currency,
  disabled,
  ...inputProps
}: {
  value: string;
  onChange: (value: string) => void;
  currency?: string | null;
  disabled?: boolean;
  id?: string;
  'aria-invalid'?: 'true';
  'aria-describedby'?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <TextField {...inputProps} inputMode="decimal" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
      {currency ? <span className="ultm8-field__hint">{currency.toUpperCase()}</span> : null}
    </div>
  );
}
