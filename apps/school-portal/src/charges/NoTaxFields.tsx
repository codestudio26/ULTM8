import React from 'react';
import { Checkbox } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';
import { formatMoney } from '../lib/money';
import { rateText } from './chargeQueries';

/**
 * Decision 414 item 5: "No tax on this item (0% or exempt)" on the create-charge
 * and recurring-charge forms, off by default. Ticked, the charge has no tax: the
 * price ex. tax and inc. tax are both the price after any discount. A rate is
 * still never typed per charge.
 */
export function NoTaxCheckbox({ id, checked, onChange }: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const t = useT();
  return (
    <div style={{ margin: '4px 0 12px' }}>
      <Checkbox id={id} label={t('charges.create.noTaxLabel')} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <p className="ultm8-field__hint" style={{ marginTop: 4 }}>
        {t('charges.create.noTaxHint')}
      </p>
    </div>
  );
}

/** The live preview's tax row: "Tax (20%)" and its amount, or "Tax: No tax". */
export function PreviewTaxRow({ taxExempt, rate, tax, currency }: { taxExempt: boolean; rate: number; tax: number; currency: string }) {
  const t = useT();
  return taxExempt ? (
    <>
      <dt>{t('charges.card.columnTax')}</dt>
      <dd style={{ margin: 0 }}>{t('charges.card.noTax')}</dd>
    </>
  ) : (
    <>
      <dt>{t('charges.create.previewTax', { rate: rateText(rate) })}</dt>
      <dd style={{ margin: 0 }}>{formatMoney(tax, currency)}</dd>
    </>
  );
}
