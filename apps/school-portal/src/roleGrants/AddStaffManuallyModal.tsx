import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, ModalActions, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, type BranchResponse } from '../branches/branchQueries';
import { useT } from '../i18n/I18nProvider';
import { NewLookSelect } from '../layout/NewLookSelect';

/**
 * Decision 251 — Staff "Add Manually": a real User + RoleGrant (role:
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
  const t = useT();
  const [form, setForm] = useState({ firstName: '', surname: '', email: '', branchId: '' });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // The branch drop-down is the new look's own, with no browser `required`
    // check, so the same guardrail is made here.
    if (!form.branchId) {
      setError(t('roleGrants.staff.selectBranchForStaff'));
      return;
    }
    try {
      await onSubmit({
        firstName: form.firstName,
        surname: form.surname,
        email: form.email,
        branchId: form.branchId,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('roleGrants.addManually.title')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('roleGrants.addManually.firstNameLabel')} htmlFor="add-staff-manually-firstName">
          <TextField required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
        </Field>
        <Field label={t('roleGrants.addManually.surnameLabel')} htmlFor="add-staff-manually-surname">
          <TextField required value={form.surname} onChange={(e) => setForm((f) => ({ ...f, surname: e.target.value }))} />
        </Field>
        <Field label={t('roleGrants.addManually.emailLabel')} htmlFor="add-staff-manually-email" hint={t('roleGrants.addManually.emailHint')}>
          <TextField required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <div className="u8n-dd-field">
          <NewLookSelect
            id="add-staff-manually-branch"
            label={t('roleGrants.addManually.branchLabel')}
            value={form.branchId}
            onChange={(branchId) => setForm((f) => ({ ...f, branchId }))}
            options={[{ value: '', label: t('roleGrants.addManually.selectBranch') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
          />
          <span className="ultm8-field__hint u8n-dd-field__hint">{t('roleGrants.addManually.branchHint')}</span>
        </div>
        <ModalActions>
          <Button type="submit" loading={submitting}>
            {t('roleGrants.addManually.submit')}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
