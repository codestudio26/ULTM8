import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from './branchQueries';

/** Fields match CreateBranchDto/UpdateBranchDto exactly (Decision 76's field list) —
 * apps/api/src/tenants/branches/dto/create-branch.dto.ts, re-verified before writing.
 *
 * FOUND ON REVIEW (Phase 53): this form covered name/address/contactPhone/
 * timezone/currencyOverride since Phase 3, but never logoUrl/bannerUrl —
 * Decision 76's own field list names "branding" explicitly, and the backend
 * (create/update DTOs, response DTO, Prisma model) has carried both fields the
 * whole time; only this form had never been updated to expose them. Added
 * here as plain-text URL fields, the same treatment Franchise/Class/
 * TimetableSlot's own forms already give logoUrl/bannerUrl elsewhere in this
 * app — no image-upload infrastructure exists for general branding assets
 * (R2 is wired up for waiver signatures specifically, Phase 34, not this).
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
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
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
          <TextField value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
        </Field>
        <Field label="Timezone" htmlFor="branch-timezone" hint="IANA name, e.g. America/New_York">
          <TextField value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} />
        </Field>
        <Field label="Currency override" htmlFor="branch-currency">
          <TextField value={form.currencyOverride} onChange={(e) => setForm((f) => ({ ...f, currencyOverride: e.target.value }))} />
        </Field>
        <Field label="Logo URL" htmlFor="branch-logo">
          <TextField value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} />
        </Field>
        <Field label="Banner URL" htmlFor="branch-banner">
          <TextField value={form.bannerUrl} onChange={(e) => setForm((f) => ({ ...f, bannerUrl: e.target.value }))} />
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
