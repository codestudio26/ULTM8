import React from 'react';
import { Field, TextField } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';
import { parseRate } from './taxLines';

export { taxLineDraft, taxLineBody, taxLinesProblem, type TaxLineDraft } from './taxLines';
import type { TaxLineDraft } from './taxLines';

export function TaxLineFields({
  id,
  line,
  onChange,
  second,
  showRate = true,
}: {
  id: string;
  line: TaxLineDraft;
  onChange: (line: TaxLineDraft) => void;
  /** The second line: its labels say so, and an empty rate means none. */
  second?: boolean;
  showRate?: boolean;
}) {
  const t = useT();
  const set = (patch: Partial<TaxLineDraft>) => onChange({ ...line, ...patch });
  return (
    <>
      <Field
        label={second ? t('charges.settings.tax2NameLabel') : t('charges.settings.taxNameLabel')}
        htmlFor={`${id}-name`}
        hint={second ? t('charges.settings.tax2NameHint') : t('charges.settings.taxNameHint')}
      >
        <TextField id={`${id}-name`} maxLength={40} value={line.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      {showRate ? (
        <Field
          label={second ? t('charges.settings.tax2RateLabel') : t('charges.settings.rateLabel')}
          htmlFor={`${id}-rate`}
          error={parseRate(line.rate) === null ? t('charges.settings.rateInvalid') : undefined}
        >
          <TextField id={`${id}-rate`} inputMode="decimal" value={line.rate} onChange={(e) => set({ rate: e.target.value })} />
        </Field>
      ) : null}
      <Field label={second ? t('charges.settings.tax2IdLabel') : t('charges.settings.taxIdLabel')} htmlFor={`${id}-tax-id`}>
        <TextField id={`${id}-tax-id`} maxLength={50} value={line.taxId} onChange={(e) => set({ taxId: e.target.value })} />
      </Field>
    </>
  );
}
