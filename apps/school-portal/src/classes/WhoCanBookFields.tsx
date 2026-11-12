import React from 'react';
import { Field, TextField } from '@ultm8/ui';
import { NewLookSelect } from '../layout/NewLookSelect';
import './classForms.css';
import { useT, type TranslateFn } from '../i18n/I18nProvider';

export type Audience = 'EVERYONE' | 'WOMEN' | 'MEN';

/** The form's "Who can book" values, as typed (ages are text until saved). */
export interface WhoCanBookForm {
  audience: Audience;
  minAge: string;
  maxAge: string;
}

export function whoCanBookForm(initial?: { audience?: Audience | null; minAge?: number | null; maxAge?: number | null }): WhoCanBookForm {
  return { audience: initial?.audience ?? 'EVERYONE', minAge: initial?.minAge?.toString() ?? '', maxAge: initial?.maxAge?.toString() ?? '' };
}

/** What the API takes: null for an age left empty. */
export function whoCanBookValues(form: WhoCanBookForm): { audience: Audience; minAge: number | null; maxAge: number | null } {
  return { audience: form.audience, minAge: form.minAge === '' ? null : Number(form.minAge), maxAge: form.maxAge === '' ? null : Number(form.maxAge) };
}

/** The same order check the API makes, or null. */
export function whoCanBookProblem(form: WhoCanBookForm, t: TranslateFn): string | null {
  const { minAge, maxAge } = whoCanBookValues(form);
  return minAge !== null && maxAge !== null && minAge > maxAge ? t('server.codes.ageRangeOrder') : null;
}

/** A short label for a class card or list, or null for "everyone". */
export function whoCanBookLabel(c: { audience?: Audience | null; minAge?: number | null; maxAge?: number | null }, t: TranslateFn): string | null {
  const parts: string[] = [];
  if (c.audience === 'WOMEN') parts.push(t('classes.whoCanBook.women'));
  if (c.audience === 'MEN') parts.push(t('classes.whoCanBook.men'));
  const min = c.minAge ?? null;
  const max = c.maxAge ?? null;
  if (min !== null && max !== null) parts.push(t('classes.whoCanBook.agesRange', { min, max }));
  else if (min !== null) parts.push(t('classes.whoCanBook.agesFrom', { min }));
  else if (max !== null) parts.push(t('classes.whoCanBook.agesTo', { max }));
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Decision 432 item 14 (AE-6): the optional "Who can book" on a one-off class
 * and on a weekly slot — everyone, women only or men only, plus an optional age
 * range. The API checks it at booking, waitlist, Kid Mode and the desk; staff
 * can still book anyone with an override reason.
 */
export function WhoCanBookFields({ idPrefix, value, onChange }: { idPrefix: string; value: WhoCanBookForm; onChange: (next: WhoCanBookForm) => void }) {
  const t = useT();
  return (
    <fieldset className="u8cf-who">
      <div className="u8n-dd-field">
        <NewLookSelect
          id={`${idPrefix}-audience`}
          label={t('classes.whoCanBook.title')}
          value={value.audience}
          onChange={(v) => onChange({ ...value, audience: v as Audience })}
          options={[
            { value: 'EVERYONE', label: t('classes.whoCanBook.everyone') },
            { value: 'WOMEN', label: t('classes.whoCanBook.women') },
            { value: 'MEN', label: t('classes.whoCanBook.men') },
          ]}
        />
        <span className="ultm8-field__hint u8n-dd-field__hint">{t('classes.whoCanBook.hint')}</span>
      </div>
      <div className="u8cf-who__ages">
        <Field label={t('classes.whoCanBook.minAge')} htmlFor={`${idPrefix}-minAge`}>
          <TextField id={`${idPrefix}-minAge`} type="number" min={0} max={120} value={value.minAge} onChange={(e) => onChange({ ...value, minAge: e.target.value })} />
        </Field>
        <Field label={t('classes.whoCanBook.maxAge')} htmlFor={`${idPrefix}-maxAge`}>
          <TextField id={`${idPrefix}-maxAge`} type="number" min={0} max={120} value={value.maxAge} onChange={(e) => onChange({ ...value, maxAge: e.target.value })} />
        </Field>
      </div>
    </fieldset>
  );
}
