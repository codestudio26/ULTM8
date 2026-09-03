import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from './branchQueries';

/** Fields match CreateBranchDto/UpdateBranchDto exactly (Decision 76's field list) —
 * apps/api/src/tenants/branches/dto/create-branch.dto.ts, re-verified before writing. */
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
    address?: string;
    contactPhone?: string;
    timezone?: string;
    currencyOverride?: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    address: initial?.address ?? '',
    contactPhone: initial?.contactPhone ?? '',
    timezone: initial?.timezone ?? '',
    currencyOverride: initial?.currencyOverride ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({
        name: form.name,
        address: form.address || undefined,
        contactPhone: form.contactPhone || undefined,
        timezone: form.timezone || undefined,
        currencyOverride: form.currencyOverride || undefined,
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
