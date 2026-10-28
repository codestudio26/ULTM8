import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, type BranchResponse } from '../branches/branchQueries';
import { useT } from '../i18n/I18nProvider';

/**
 * Decision 1/230/237 — a real Instructor record created immediately from
 * just a name and email, no invite/acceptance step. A deliberately separate,
 * smaller form from InstructorFormModal — that one picks from a User who
 * already holds an Instructor role; this one creates that User (and the
 * role) in one step. `branchId` is required only when the School has
 * branches (same rule the backend enforces — this is a client-side
 * guardrail, not a new restriction).
 */
export function AddInstructorManuallyModal({
  branches,
  submitting,
  onSubmit,
  onClose,
}: {
  branches: BranchResponse[];
  submitting: boolean;
  onSubmit: (values: { firstName: string; surname: string; email: string; branchId?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState({ firstName: '', surname: '', email: '', branchId: '' });
  const [error, setError] = useState<string | null>(null);
  const requiresBranch = branches.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({
        firstName: form.firstName,
        surname: form.surname,
        email: form.email,
        ...(form.branchId ? { branchId: form.branchId } : {}),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('instructors.manualModal.title')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('instructors.manualModal.firstName')} htmlFor="add-manually-firstName">
          <TextField required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
        </Field>
        <Field label={t('instructors.manualModal.surname')} htmlFor="add-manually-surname">
          <TextField required value={form.surname} onChange={(e) => setForm((f) => ({ ...f, surname: e.target.value }))} />
        </Field>
        <Field label={t('instructors.manualModal.email')} htmlFor="add-manually-email" hint={t('instructors.manualModal.emailHint')}>
          <TextField required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        {requiresBranch ? (
          <Field label={t('instructors.manualModal.branch')} htmlFor="add-manually-branch">
            <SelectField
              required
              value={form.branchId}
              onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
              options={[{ value: '', label: t('instructors.manualModal.branchPlaceholder') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
            />
          </Field>
        ) : null}
        <Button type="submit" loading={submitting}>
          {t('instructors.manualModal.submit')}
        </Button>
      </form>
    </Modal>
  );
}
