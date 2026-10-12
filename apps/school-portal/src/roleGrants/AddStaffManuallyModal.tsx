import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from '../branches/branchQueries';

/**
 * Decision 246 — Staff "Add Manually": a real User + RoleGrant (role:
 * BRANCH_STAFF) created immediately from just a name, email, and branch —
 * no invite/acceptance step. Mirrors AddInstructorManuallyModal.tsx's exact
 * shape, with one deliberate difference: `branchId` is ALWAYS required
 * here (no "requiresBranch" conditional) — Branch Staff always belongs to
 * a specific Branch, unlike Instructor, which only needs one when the
 * School itself has branches (same rule StaffPage.tsx's own `needsBranch`
 * logic already assumes, and CreateStaffManuallyDto enforces server-side).
 */
export function AddStaffManuallyModal({
  branches,
  submitting,
  onSubmit,
  onClose,
}: {
  branches: BranchResponse[];
  submitting: boolean;
  onSubmit: (values: { firstName: string; surname: string; email: string; branchId: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ firstName: '', surname: '', email: '', branchId: '' });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({
        firstName: form.firstName,
        surname: form.surname,
        email: form.email,
        branchId: form.branchId,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title="Add staff manually" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="First name" htmlFor="add-staff-manually-firstName">
          <TextField required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
        </Field>
        <Field label="Surname" htmlFor="add-staff-manually-surname">
          <TextField required value={form.surname} onChange={(e) => setForm((f) => ({ ...f, surname: e.target.value }))} />
        </Field>
        <Field label="Email" htmlFor="add-staff-manually-email" hint="A temporary passcode is emailed here — they'll choose their own on first login.">
          <TextField required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="Branch" htmlFor="add-staff-manually-branch" hint="Branch Staff always belongs to a specific Branch.">
          <SelectField
            required
            value={form.branchId}
            onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
            options={[{ value: '', label: 'Select a branch…' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </Field>
        <Button type="submit" loading={submitting}>
          Add staff
        </Button>
      </form>
    </Modal>
  );
}
