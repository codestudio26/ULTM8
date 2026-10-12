import React, { useState } from 'react';
import { Button, CurrencyField, ErrorBanner, Field, Modal, PhoneField, PhotoUploadField, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import type { FranchiseResponse } from './franchiseQueries';

const FEE_MODELS = ['FLAT', 'PER_HEADCOUNT'] as const;

export interface FranchiseFormValues {
  name: string;
  /** `null` means "cleared" — UpdateFranchiseDto accepts `null` on these
   * fields to mean exactly that (see that DTO's own header comment); the
   * page-level caller maps `null` back to `undefined` for the CREATE path,
   * which has nothing to clear. */
  mobileNumber?: string | null;
  address?: string | null;
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
}

/** Fields match CreateFranchiseDto/UpdateFranchiseDto exactly —
 * apps/api/src/tenants/franchises/dto/create-franchise.dto.ts, re-verified
 * before writing this. Cross-field rate-change rules
 * (FranchisesService.update()'s own schoolsAlreadyBilling guard, which
 * rejects a rate change once any member School has started billing) are
 * enforced server-side, not duplicated here — same convention every other
 * form modal in this codebase already follows for its own service-side
 * cross-field checks (e.g. MembershipPlanFormPage). */
export function FranchiseFormModal({
  title,
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<FranchiseResponse>;
  submitting: boolean;
  onSubmit: (values: FranchiseFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    mobileNumber: initial?.mobileNumber ?? '',
    address: initial?.address ?? '',
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
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({
        name: form.name,
        mobileNumber: form.mobileNumber || null,
        address: form.address || null,
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
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Franchise name" htmlFor="franchise-name">
          <TextField required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Mobile number" htmlFor="franchise-mobile">
          <PhoneField
            value={form.mobileNumber}
            onChange={(v) => setForm((f) => ({ ...f, mobileNumber: v }))}
            defaultCountry={guessDefaultCountry()}
          />
        </Field>
        <Field label="Address" htmlFor="franchise-address">
          <TextField value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </Field>
        <Field label="Type" htmlFor="franchise-type">
          <TextField value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} />
        </Field>
        <Field label="Activities" htmlFor="franchise-activities" hint="Comma-separated, e.g. Jiu Jitsu, Karate, Judo">
          <TextField value={form.activities} onChange={(e) => setForm((f) => ({ ...f, activities: e.target.value }))} />
        </Field>
        <Field label="Facilities" htmlFor="franchise-facilities" hint="Comma-separated">
          <TextField value={form.facilities} onChange={(e) => setForm((f) => ({ ...f, facilities: e.target.value }))} />
        </Field>
        <Field label="Default language" htmlFor="franchise-language">
          <SelectField
            id="franchise-language"
            value={form.defaultLanguage}
            onChange={(e) => setForm((f) => ({ ...f, defaultLanguage: e.target.value }))}
            options={[{ value: '', label: 'Not set' }, ...(languages ?? []).map((l) => ({ value: l.code, label: l.name }))]}
          />
        </Field>
        <Field label="Default currency" htmlFor="franchise-currency">
          <CurrencyField
            id="franchise-currency"
            value={form.defaultCurrency}
            onChange={(code) => setForm((f) => ({ ...f, defaultCurrency: code }))}
            options={[{ code: '', name: 'Not set' }, ...(currencies ?? [])]}
            placeholder="Not set"
          />
        </Field>
        <Field label="Description" htmlFor="franchise-description">
          <TextField value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <Field label="Logo" htmlFor="franchise-logo">
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
        <Field label="Banner" htmlFor="franchise-banner">
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
        <Field label="Fee model" htmlFor="franchise-feeModel">
          <SelectField
            value={form.feeModel}
            onChange={(e) => setForm((f) => ({ ...f, feeModel: e.target.value as (typeof FEE_MODELS)[number] }))}
            options={[
              { value: 'FLAT', label: 'Flat' },
              { value: 'PER_HEADCOUNT', label: 'Per-headcount' },
            ]}
          />
        </Field>
        <Field
          label="Flat fee amount"
          htmlFor="franchise-flatFee"
          hint={
            initial
              ? "Minor currency unit (e.g. cents). Only meaningful when Fee model is Flat. Can't be changed once any member School has started billing."
              : 'Minor currency unit (e.g. cents). Only meaningful when Fee model is Flat.'
          }
        >
          <TextField
            type="number"
            min={0}
            value={form.flatFeeAmount}
            onChange={(e) => setForm((f) => ({ ...f, flatFeeAmount: e.target.value }))}
          />
        </Field>
        <Field
          label="Per-headcount rate"
          htmlFor="franchise-perHeadcount"
          hint={
            initial
              ? "Minor currency unit (e.g. cents) per active Student per month. Only meaningful when Fee model is Per-headcount. Can't be changed once any member School has started billing."
              : 'Minor currency unit (e.g. cents) per active Student per month. Only meaningful when Fee model is Per-headcount.'
          }
        >
          <TextField
            type="number"
            min={0}
            value={form.perHeadcountRate}
            onChange={(e) => setForm((f) => ({ ...f, perHeadcountRate: e.target.value }))}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
