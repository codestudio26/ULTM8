import React, { useState } from 'react';
import { AddressFields, Button, CurrencyField, ErrorBanner, Field, Modal, PhoneField, PhotoUploadField, SelectField, TextField, hasLegacyAddressOnly, postalAddressFromRecord, preparePostalAddress, type PostalAddress, type PostalAddressErrors } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import type { FranchiseResponse } from './franchiseQueries';
import { useT } from '../i18n/I18nProvider';
import { languageName } from '../i18n/format';

const FEE_MODELS = ['FLAT', 'PER_HEADCOUNT'] as const;

const FEE_RATE_CHANGE_STRATEGIES = ['MIGRATE_NEXT_CYCLE', 'MIGRATE_IMMEDIATE'] as const;

export interface FranchiseFormValues {
  name: string;
  /** `null` means "cleared" — UpdateFranchiseDto accepts `null` on these
   * fields to mean exactly that (see that DTO's own header comment); the
   * page-level caller maps `null` back to `undefined` for the CREATE path,
   * which has nothing to clear. */
  mobileNumber?: string | null;
  postalAddress?: PostalAddress | null;
  type?: string | null;
  activities: string[];
  facilities: string[];
  defaultLanguage?: string | null;
  defaultCurrency?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  feeModel: (typeof FEE_MODELS)[number];
  /** Deliberately never sent as `null` from this form — see
   * UpdateFranchiseDto's own header comment on why clearing a configured fee
   * rate is out of scope this phase. Left blank means "don't change it"
   * (omitted from the request), not "clear it". */
  flatFeeAmount?: number;
  perHeadcountRate?: number;
  /** Decision 99's own follow-up — omitted unless feeRateChangeDecisionRequired. */
  feeRateChangeStrategy?: (typeof FEE_RATE_CHANGE_STRATEGIES)[number];
}

/** Fields match CreateFranchiseDto/UpdateFranchiseDto exactly —
 * apps/api/src/tenants/franchises/dto/create-franchise.dto.ts, re-verified
 * before writing this. Decision 99's own follow-up: a rate change once any
 * member School has started billing now requires `feeRateChangeStrategy`
 * (FranchisesService.update()'s own schoolsAlreadyBilling guard) — mirrored
 * client-side via `schoolsAlreadyBillingCount` (fetched up front by the page,
 * not guessed) so the prompt shows before the identical 400 would, same
 * "query, don't guess" shape MembershipPlanFormPage's own price-change prompt
 * already establishes. */
export function FranchiseFormModal({
  title,
  initial,
  schoolsAlreadyBillingCount = 0,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<FranchiseResponse>;
  /** Decision 99's own follow-up — how many member Schools already have a
   * standing franchise-fee Stripe Subscription, fetched up front
   * (useFranchiseBillingStatus) so this prompt can show before the identical
   * 400 would, same "query, don't guess" shape MembershipPlanFormPage's own
   * activeSubscriberCount prop already establishes. 0 for the create path —
   * there's nothing to migrate yet. */
  schoolsAlreadyBillingCount?: number;
  submitting: boolean;
  onSubmit: (values: FranchiseFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    mobileNumber: initial?.mobileNumber ?? '',
    address: postalAddressFromRecord(initial, guessDefaultCountry()),
    type: initial?.type ?? '',
    activities: initial?.activities?.join(', ') ?? '',
    facilities: initial?.facilities?.join(', ') ?? '',
    defaultLanguage: initial?.defaultLanguage ?? '',
    defaultCurrency: initial?.defaultCurrency ?? '',
    description: initial?.description ?? '',
    logoUrl: initial?.logoUrl ?? '',
    bannerUrl: initial?.bannerUrl ?? '',
    feeModel: (initial?.feeModel as (typeof FEE_MODELS)[number]) ?? 'FLAT',
    flatFeeAmount: initial?.flatFeeAmount?.toString() ?? '',
    perHeadcountRate: initial?.perHeadcountRate?.toString() ?? '',
  });
  const [feeRateChangeStrategy, setFeeRateChangeStrategy] = useState<(typeof FEE_RATE_CHANGE_STRATEGIES)[number] | ''>('');
  const [initialAddress] = useState(() => (initial ? postalAddressFromRecord(initial, guessDefaultCountry()) : undefined));
  const [addressErrors, setAddressErrors] = useState<PostalAddressErrors>({});
  const [error, setError] = useState<string | null>(null);

  // Decision 99's own follow-up — mirrors FranchisesService.update()'s own
  // `changingRate` check exactly (both rate fields, not just the one the
  // currently-selected feeModel uses — the server checks both too, since a
  // Franchise can hold a configured rate for a feeModel it isn't currently
  // active under). Required only while editing (a brand-new Franchise has no
  // Schools to migrate) and only once at least one School is already billing.
  const flatChanged = initial && form.flatFeeAmount !== '' && Number(form.flatFeeAmount) !== (initial.flatFeeAmount ?? null);
  const perHeadcountChanged = initial && form.perHeadcountRate !== '' && Number(form.perHeadcountRate) !== (initial.perHeadcountRate ?? null);
  const feeRateChangeDecisionRequired = !!initial && (flatChanged || perHeadcountChanged) && schoolsAlreadyBillingCount > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (feeRateChangeDecisionRequired && !feeRateChangeStrategy) {
      setError(t('franchises.form.rateChangeRequired', { count: schoolsAlreadyBillingCount }));
      return;
    }
    const prepared = preparePostalAddress(form.address, initialAddress);
    if (!prepared.ok) {
      setAddressErrors(prepared.errors);
      return;
    }
    setAddressErrors({});
    try {
      await onSubmit({
        name: form.name,
        mobileNumber: form.mobileNumber || null,
        postalAddress: prepared.postalAddress,
        type: form.type || null,
        activities: form.activities.split(',').map((s) => s.trim()).filter(Boolean),
        facilities: form.facilities.split(',').map((s) => s.trim()).filter(Boolean),
        defaultLanguage: form.defaultLanguage || null,
        defaultCurrency: form.defaultCurrency || null,
        description: form.description || null,
        logoUrl: form.logoUrl || null,
        bannerUrl: form.bannerUrl || null,
        feeModel: form.feeModel,
        flatFeeAmount: form.flatFeeAmount ? Number(form.flatFeeAmount) : undefined,
        perHeadcountRate: form.perHeadcountRate ? Number(form.perHeadcountRate) : undefined,
        feeRateChangeStrategy: feeRateChangeDecisionRequired && feeRateChangeStrategy ? feeRateChangeStrategy : undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('franchises.form.nameLabel')} htmlFor="franchise-name">
          <TextField required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label={t('franchises.form.mobileLabel')} htmlFor="franchise-mobile">
          <PhoneField
            value={form.mobileNumber}
            onChange={(v) => setForm((f) => ({ ...f, mobileNumber: v }))}
            defaultCountry={guessDefaultCountry()}
          />
        </Field>
        <AddressFields
          idPrefix="franchise-address"
          value={form.address}
          onChange={(address) => setForm((f) => ({ ...f, address }))}
          errors={addressErrors}
          legacy={hasLegacyAddressOnly(initial) && !form.address.country}
        />
        <Field label={t('franchises.form.typeLabel')} htmlFor="franchise-type">
          <TextField value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} />
        </Field>
        <Field label={t('franchises.form.activitiesLabel')} htmlFor="franchise-activities" hint={t('franchises.form.activitiesHint')}>
          <TextField value={form.activities} onChange={(e) => setForm((f) => ({ ...f, activities: e.target.value }))} />
        </Field>
        <Field label={t('franchises.form.facilitiesLabel')} htmlFor="franchise-facilities" hint={t('franchises.form.facilitiesHint')}>
          <TextField value={form.facilities} onChange={(e) => setForm((f) => ({ ...f, facilities: e.target.value }))} />
        </Field>
        <Field label={t('franchises.form.languageLabel')} htmlFor="franchise-language">
          <SelectField
            id="franchise-language"
            value={form.defaultLanguage}
            onChange={(e) => setForm((f) => ({ ...f, defaultLanguage: e.target.value }))}
            options={[{ value: '', label: t('franchises.form.notSet') }, ...(languages ?? []).map((l) => ({ value: l.code, label: languageName(l.code, l.name) }))]}
          />
        </Field>
        <Field label={t('franchises.form.currencyLabel')} htmlFor="franchise-currency">
          <CurrencyField
            id="franchise-currency"
            value={form.defaultCurrency}
            onChange={(code) => setForm((f) => ({ ...f, defaultCurrency: code }))}
            options={[{ code: '', name: t('franchises.form.notSet') }, ...(currencies ?? [])]}
            placeholder={t('franchises.form.notSet')}
          />
        </Field>
        <Field label={t('franchises.form.descriptionLabel')} htmlFor="franchise-description">
          <TextField value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <Field label={t('franchises.form.logoLabel')} htmlFor="franchise-logo">
          <PhotoUploadField
            value={form.logoUrl}
            onChange={(logoUrl) => setForm((f) => ({ ...f, logoUrl }))}
            requestUpload={(file) =>
              requestPhotoUpload.mutateAsync({
                entityType: 'FRANCHISE',
                franchiseId: initial?.id,
                contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
              })
            }
          />
        </Field>
        <Field label={t('franchises.form.bannerLabel')} htmlFor="franchise-banner">
          <PhotoUploadField
            value={form.bannerUrl}
            onChange={(bannerUrl) => setForm((f) => ({ ...f, bannerUrl }))}
            requestUpload={(file) =>
              requestPhotoUpload.mutateAsync({
                entityType: 'FRANCHISE',
                franchiseId: initial?.id,
                contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
              })
            }
          />
        </Field>
        <Field label={t('franchises.form.feeModelLabel')} htmlFor="franchise-feeModel">
          <SelectField
            value={form.feeModel}
            onChange={(e) => setForm((f) => ({ ...f, feeModel: e.target.value as (typeof FEE_MODELS)[number] }))}
            options={[
              { value: 'FLAT', label: t('franchises.feeModels.flat') },
              { value: 'PER_HEADCOUNT', label: t('franchises.feeModels.perHeadcount') },
            ]}
          />
        </Field>
        <Field
          label={t('franchises.form.flatFeeLabel')}
          htmlFor="franchise-flatFee"
          hint={initial ? t('franchises.form.flatFeeHintEditing') : t('franchises.form.flatFeeHint')}
        >
          <TextField
            type="number"
            min={0}
            value={form.flatFeeAmount}
            onChange={(e) => setForm((f) => ({ ...f, flatFeeAmount: e.target.value }))}
          />
        </Field>
        <Field
          label={t('franchises.form.perHeadcountLabel')}
          htmlFor="franchise-perHeadcount"
          hint={initial ? t('franchises.form.perHeadcountHintEditing') : t('franchises.form.perHeadcountHint')}
        >
          <TextField
            type="number"
            min={0}
            value={form.perHeadcountRate}
            onChange={(e) => setForm((f) => ({ ...f, perHeadcountRate: e.target.value }))}
          />
        </Field>
        {feeRateChangeDecisionRequired ? (
          // Decision 99's own follow-up — shown only when it's actually
          // relevant (see feeRateChangeDecisionRequired's own comment above)
          // — a required choice, not a dismissible hint, so Save stays
          // blocked (handleSubmit's own check) until one is picked. Same
          // two-button-choice shape MembershipPlanFormPage's own price-change
          // prompt already establishes.
          <Field label={t('franchises.form.rateChangeLabel')} htmlFor="franchise-fee-rate-change-strategy">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
                {t('franchises.form.rateChangeBilling', { count: schoolsAlreadyBillingCount })}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  type="button"
                  variant={feeRateChangeStrategy === 'MIGRATE_NEXT_CYCLE' ? 'primary' : 'secondary'}
                  onClick={() => setFeeRateChangeStrategy('MIGRATE_NEXT_CYCLE')}
                >
                  {t('franchises.form.applyNextCycle')}
                </Button>
                <Button
                  type="button"
                  variant={feeRateChangeStrategy === 'MIGRATE_IMMEDIATE' ? 'primary' : 'secondary'}
                  onClick={() => setFeeRateChangeStrategy('MIGRATE_IMMEDIATE')}
                >
                  {t('franchises.form.applyImmediately')}
                </Button>
              </div>
              <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
                {feeRateChangeStrategy === 'MIGRATE_NEXT_CYCLE'
                  ? t('franchises.form.nextCycleExplanation')
                  : feeRateChangeStrategy === 'MIGRATE_IMMEDIATE'
                    ? form.feeModel === 'PER_HEADCOUNT'
                      ? t('franchises.form.immediatePerHeadcountExplanation')
                      : t('franchises.form.immediateFlatExplanation')
                    : t('franchises.form.pickOne')}
              </p>
            </div>
          </Field>
        ) : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            {t('common.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
