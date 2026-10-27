import React from 'react';
import { Checkbox, Field, SelectField, TextField } from '@ultm8/ui';
import type { components } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';

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

/** The form's own shape: the two optional numbers as text, so a blank box means "none". */
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
    noShowFee: source.noShowFee?.toString() ?? '',
  };
}

export function cancellationSettingsPayload(form: CancellationSettingsForm) {
  return {
    classCancellationPolicy: form.classCancellationPolicy,
    classCancellationPolicyWindow: form.classCancellationPolicyWindow,
    chargeLateCancellationFee: form.chargeLateCancellationFee,
    schoolCancelledClassResolution: form.schoolCancelledClassResolution,
    defaultRefundCutoffHours: form.defaultRefundCutoffHours === '' ? null : Number(form.defaultRefundCutoffHours),
    noShowFee: form.noShowFee === '' || Number(form.noShowFee) === 0 ? null : Number(form.noShowFee),
  };
}

export function CancellationSettingsFields({
  form,
  onChange,
  disabled = false,
}: {
  form: CancellationSettingsForm;
  onChange: (next: CancellationSettingsForm) => void;
  disabled?: boolean;
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
      <Field label={t('schools.cancellations.noShowFeeLabel')} htmlFor="cancel-no-show-fee" hint={t('schools.cancellations.noShowFeeHint')}>
        <TextField id="cancel-no-show-fee" type="number" min={0} disabled={disabled} value={form.noShowFee} onChange={(e) => set('noShowFee', e.target.value)} />
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
