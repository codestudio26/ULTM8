import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, PhoneField, PhotoUploadField, SelectField, TextField, TimezoneField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useCurrencies } from '../settings/settingsQueries';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import type { BranchResponse } from './branchQueries';

/** Fields match CreateBranchDto/UpdateBranchDto exactly (Decision 76's field list) —
 * apps/api/src/tenants/branches/dto/create-branch.dto.ts, re-verified before writing.
 *
 * FOUND ON REVIEW (Phase 53): this form covered name/address/contactPhone/
 * timezone/currencyOverride since Phase 3, but never logoUrl/bannerUrl —
 * Decision 76's own field list names "branding" explicitly, and the backend
 * (create/update DTOs, response DTO, Prisma model) has carried both fields the
 * whole time; only this form had never been updated to expose them. Originally
 * added as plain-text URL fields (no image-upload infrastructure existed for
 * general branding assets at the time — R2 was wired up for waiver signatures
 * specifically, Phase 34, not this); now a real `PhotoUploadField` as of the
 * real-photo-uploads phase (product-owner-approved — see
 * apps/api/src/uploads/uploads.module.ts's own header comment), same as every
 * other photo/logo/banner field app-wide.
 *
 * FOUND ON REVIEW (Phase 18): `null` (not `undefined`) means "the field was
 * cleared" — UpdateBranchDto now accepts `null` on these fields to mean
 * exactly that (this exact bug — a cleared field silently no-op'ing on save —
 * has been live since Phase 3; see that DTO's own header comment for the full
 * reasoning). `BranchesPage` maps `null` back to `undefined` for the CREATE
 * path, where there's nothing to clear and CreateBranchDto doesn't accept
 * `null` on these fields. */
export function BranchFormModal({
  title,
  schoolId,
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  /** Required so the Logo/Banner fields' upload URL requests can be
   * authorized (School Owner at this School — see UploadsService's own
   * comment). This modal is create-only today (Decision 231 moved editing to
   * BranchSettingsPage), so there is never an existing Branch id to key the
   * upload under — entityId is omitted, a fresh id stands in (see
   * UploadsService.requestPublicPhotoUploadUrl's own comment on that). */
  schoolId: string;
  initial?: Partial<BranchResponse>;
  submitting: boolean;
  onSubmit: (values: {
    name: string;
    address?: string | null;
    contactPhone?: string | null;
    timezone?: string | null;
    currencyOverride?: string | null;
    logoUrl?: string | null;
    bannerUrl?: string | null;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const { data: currencies } = useCurrencies();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    address: initial?.address ?? '',
    contactPhone: initial?.contactPhone ?? '',
    timezone: initial?.timezone ?? '',
    currencyOverride: initial?.currencyOverride ?? '',
    logoUrl: initial?.logoUrl ?? '',
    bannerUrl: initial?.bannerUrl ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({
        name: form.name,
        address: form.address || null,
        contactPhone: form.contactPhone || null,
        timezone: form.timezone || null,
        currencyOverride: form.currencyOverride || null,
        logoUrl: form.logoUrl || null,
        bannerUrl: form.bannerUrl || null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Branch name" htmlFor="branch-name">
          <TextField required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Address" htmlFor="branch-address">
          <TextField value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </Field>
        <Field label="Contact phone" htmlFor="branch-phone">
          <PhoneField
            value={form.contactPhone}
            onChange={(v) => setForm((f) => ({ ...f, contactPhone: v }))}
            defaultCountry={guessDefaultCountry()}
          />
        </Field>
        <Field label="Timezone" htmlFor="branch-timezone">
          <TimezoneField value={form.timezone} onChange={(timezone) => setForm((f) => ({ ...f, timezone }))} />
        </Field>
        <Field label="Currency override" htmlFor="branch-currency">
          <SelectField
            id="branch-currency"
            value={form.currencyOverride}
            onChange={(e) => setForm((f) => ({ ...f, currencyOverride: e.target.value }))}
            options={[{ value: '', label: 'Not set' }, ...(currencies ?? []).map((c) => ({ value: c.code, label: c.name }))]}
          />
        </Field>
        <Field label="Logo" htmlFor="branch-logo">
          <PhotoUploadField
            value={form.logoUrl}
            onChange={(logoUrl) => setForm((f) => ({ ...f, logoUrl }))}
            requestUpload={(file) =>
              requestPhotoUpload.mutateAsync({ entityType: 'BRANCH', schoolId, contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp' })
            }
          />
        </Field>
        <Field label="Banner" htmlFor="branch-banner">
          <PhotoUploadField
            value={form.bannerUrl}
            onChange={(bannerUrl) => setForm((f) => ({ ...f, bannerUrl }))}
            requestUpload={(file) =>
              requestPhotoUpload.mutateAsync({ entityType: 'BRANCH', schoolId, contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp' })
            }
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
