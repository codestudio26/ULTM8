import React, { useEffect, useMemo, useState } from 'react';
import { Button, COUNTRY_NAMES, Card, ErrorBanner, Field, SelectField, SuccessBanner, Switch, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useUpdateSchool, type SchoolResponse } from '../schools/schoolQueries';
import { parseRate, rateText, useStandardTaxRates } from './chargeQueries';

/** Country names in the reader's language, sorted in it. */
function useCountryOptions() {
  const locale = formatLocale();
  return useMemo(() => {
    let names: Intl.DisplayNames | undefined;
    try {
      names = locale ? new Intl.DisplayNames([locale], { type: 'region' }) : undefined;
    } catch {
      names = undefined;
    }
    return COUNTRY_NAMES.map(([code, name]) => ({ value: code, label: names?.of(code) ?? name })).sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [locale]);
}

/**
 * Decision 411: tax on staff-created charges is set by the School, one rate
 * per School. Picking the country fills in ULTM8's standard rate for it; the
 * owner can change the rate and say whether prices include tax. Also the tax
 * ID for receipts (Decision 338 item 6) and whether cancelling a charge needs
 * a reason (Decision 338 item 1). Step 4 adds whether refunds need notes (item
 * 3, on by default), the address and payment instructions for receipts (item
 * 6) and the payment notification switches (item 10, all on by default). Owner
 * only, like the rest of the School page.
 */
export function ChargeSettingsCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const update = useUpdateSchool(schoolId);
  const rates = useStandardTaxRates();
  const countries = useCountryOptions();
  const [country, setCountry] = useState(school.taxCountry ?? school.addressCountry ?? '');
  const [rate, setRate] = useState(rateText(school.taxRateBasisPoints ?? 0));
  const [inclusive, setInclusive] = useState(school.taxInclusive ?? true);
  const [taxId, setTaxId] = useState(school.taxId ?? '');
  const [reasonRequired, setReasonRequired] = useState(school.chargeCancelReasonRequired ?? true);
  const [notesRequired, setNotesRequired] = useState(school.chargeRefundNotesRequired ?? true);
  const [address, setAddress] = useState(school.receiptAddress ?? '');
  const [instructions, setInstructions] = useState(school.receiptPaymentInstructions ?? '');
  const [noticeReceipt, setNoticeReceipt] = useState(school.chargeNoticeReceipt ?? true);
  const [noticeFailedOverdue, setNoticeFailedOverdue] = useState(school.chargeNoticeFailedOverdue ?? true);
  const [noticeDispute, setNoticeDispute] = useState(school.chargeNoticeDispute ?? true);
  const [noticeDueReminder, setNoticeDueReminder] = useState(school.chargeNoticeDueReminder ?? true);
  const [noticeRefund, setNoticeRefund] = useState(school.chargeNoticeRefund ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const parsedRate = parseRate(rate);
  const standard = (rates.data?.items ?? []).find((r) => r.country === country);
  const countryLabel = countries.find((c) => c.value === country)?.label ?? country;

  // A School that never set its tax starts from the country in its address,
  // with that country's rate filled in (it is saved only when the owner saves).
  useEffect(() => {
    if (school.taxCountry || !school.addressCountry || (school.taxRateBasisPoints ?? 0) !== 0) return;
    const pre = (rates.data?.items ?? []).find((r) => r.country === school.addressCountry);
    if (pre) setRate(rateText(pre.rateBasisPoints));
  }, [rates.data, school.taxCountry, school.addressCountry, school.taxRateBasisPoints]);

  function changed() {
    setSaved(false);
  }

  function chooseCountry(code: string) {
    setCountry(code);
    changed();
    const pre = (rates.data?.items ?? []).find((r) => r.country === code);
    if (pre) setRate(rateText(pre.rateBasisPoints));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedRate === null) return;
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync({
        taxCountry: country || null,
        taxRateBasisPoints: parsedRate,
        taxInclusive: inclusive,
        taxId: taxId.trim() || null,
        chargeCancelReasonRequired: reasonRequired,
        chargeRefundNotesRequired: notesRequired,
        receiptAddress: address.trim() || null,
        receiptPaymentInstructions: instructions.trim() || null,
        chargeNoticeReceipt: noticeReceipt,
        chargeNoticeFailedOverdue: noticeFailedOverdue,
        chargeNoticeDispute: noticeDispute,
        chargeNoticeDueReminder: noticeDueReminder,
        chargeNoticeRefund: noticeRefund,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} data-testid="charge-settings">
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('charges.settings.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('charges.settings.subtitle')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <Field
          label={t('charges.settings.countryLabel')}
          htmlFor="charge-tax-country"
          hint={standard && !standard.national ? t('charges.settings.noNationalRate', { country: countryLabel }) : t('charges.settings.countryHint')}
        >
          <SelectField
            id="charge-tax-country"
            value={country}
            onChange={(e) => chooseCountry(e.target.value)}
            options={[{ value: '', label: t('charges.settings.countryNone') }, ...countries]}
          />
        </Field>
        <Field
          label={t('charges.settings.rateLabel')}
          htmlFor="charge-tax-rate"
          hint={t('charges.settings.rateHint')}
          error={parsedRate === null ? t('charges.settings.rateInvalid') : undefined}
        >
          <TextField
            id="charge-tax-rate"
            inputMode="decimal"
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              changed();
            }}
          />
        </Field>
        <Field label={t('charges.settings.pricesLabel')} htmlFor="charge-tax-inclusive">
          <SelectField
            id="charge-tax-inclusive"
            value={inclusive ? 'include' : 'add'}
            onChange={(e) => {
              setInclusive(e.target.value === 'include');
              changed();
            }}
            options={[
              { value: 'include', label: t('charges.settings.pricesInclude') },
              { value: 'add', label: t('charges.settings.pricesAddOnTop') },
            ]}
          />
        </Field>
        <Field label={t('charges.settings.taxIdLabel')} htmlFor="charge-tax-id" hint={t('charges.settings.taxIdHint')}>
          <TextField
            id="charge-tax-id"
            maxLength={50}
            value={taxId}
            onChange={(e) => {
              setTaxId(e.target.value);
              changed();
            }}
          />
        </Field>
        <Switch
          id="charge-cancel-reason-required"
          label={t('charges.settings.reasonRequired')}
          description={t('charges.settings.reasonRequiredHint')}
          checked={reasonRequired}
          onChange={(on) => {
            setReasonRequired(on);
            changed();
          }}
        />
        <Switch
          id="charge-refund-notes-required"
          label={t('charges.settings.refundNotesRequired')}
          description={t('charges.settings.refundNotesRequiredHint')}
          checked={notesRequired}
          onChange={(on) => {
            setNotesRequired(on);
            changed();
          }}
        />
        <Field label={t('charges.settings.receiptAddressLabel')} htmlFor="charge-receipt-address" hint={t('charges.settings.receiptAddressHint')}>
          <TextArea
            id="charge-receipt-address"
            maxLength={300}
            rows={3}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              changed();
            }}
          />
        </Field>
        <Field label={t('charges.settings.paymentInstructionsLabel')} htmlFor="charge-payment-instructions" hint={t('charges.settings.paymentInstructionsHint')}>
          <TextArea
            id="charge-payment-instructions"
            maxLength={1000}
            rows={3}
            value={instructions}
            onChange={(e) => {
              setInstructions(e.target.value);
              changed();
            }}
          />
        </Field>
        <h3 style={{ fontSize: 15, margin: '16px 0 4px' }}>{t('charges.settings.noticesHeading')}</h3>
        <p className="ultm8-field__hint" style={{ margin: '0 0 8px' }}>
          {t('charges.settings.noticesIntro')}
        </p>
        <Switch
          id="charge-notice-due-reminder"
          label={t('charges.settings.noticeDueReminder')}
          checked={noticeDueReminder}
          onChange={(on) => {
            setNoticeDueReminder(on);
            changed();
          }}
        />
        <Switch
          id="charge-notice-receipt"
          label={t('charges.settings.noticeReceipt')}
          checked={noticeReceipt}
          onChange={(on) => {
            setNoticeReceipt(on);
            changed();
          }}
        />
        <Switch
          id="charge-notice-failed-overdue"
          label={t('charges.settings.noticeFailedOverdue')}
          checked={noticeFailedOverdue}
          onChange={(on) => {
            setNoticeFailedOverdue(on);
            changed();
          }}
        />
        <Switch
          id="charge-notice-dispute"
          label={t('charges.settings.noticeDispute')}
          checked={noticeDispute}
          onChange={(on) => {
            setNoticeDispute(on);
            changed();
          }}
        />
        <Switch
          id="charge-notice-refund"
          label={t('charges.settings.noticeRefund')}
          checked={noticeRefund}
          onChange={(on) => {
            setNoticeRefund(on);
            changed();
          }}
        />
        <Button type="submit" loading={update.isPending} disabled={parsedRate === null}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}
