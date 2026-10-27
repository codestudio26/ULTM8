import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { branchSelectOptions, useBranches } from '../branches/branchQueries';
import { useInviteStudent } from './studentQueries';
import { useT } from '../i18n/I18nProvider';

/** Re-enrol (Decision 371, Students Q3) — the owner enrols a former student
 * again, from their page, with a new home branch when the School has branches
 * (revoking removed the old one, Decision 341, S13). The same
 * POST /schools/{id}/join Invite uses, so the student gets the "added" notice. */
export function ReEnrolModal({ schoolId, studentId, studentName, onClose }: { schoolId: string; studentId: string; studentName: string; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: branchData } = useBranches(schoolId);
  const enrol = useInviteStudent();
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const branches = branchData?.items ?? [];
  const needsBranch = branches.some((b) => !b.archivedAt);

  async function confirm() {
    setError(null);
    if (needsBranch && !branchId) {
      setError(t('students.invite.selectBranch'));
      return;
    }
    try {
      await enrol.mutateAsync({ schoolId, body: { studentId, branchId: needsBranch ? branchId : undefined } });
      await queryClient.invalidateQueries({ queryKey: ['roleGrants', studentId] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('students.reEnrol.title', { name: studentName })} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ marginTop: 0 }}>{t('students.reEnrol.description')}</p>
      {needsBranch ? (
        <Field label={t('students.invite.homeBranch')} htmlFor="re-enrol-branch">
          <SelectField
            id="re-enrol-branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={[{ value: '', label: t('students.invite.branchPlaceholder') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
          />
        </Field>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={confirm} loading={enrol.isPending}>
          {t('students.reEnrol.confirm')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
