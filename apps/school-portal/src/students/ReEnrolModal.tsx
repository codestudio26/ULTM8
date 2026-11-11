import React, { useState } from 'react';
import { Button, ErrorBanner, Modal, ModalActions } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { branchSelectOptions, useBranches } from '../branches/branchQueries';
import { useInviteStudent } from './studentQueries';
import { useT } from '../i18n/I18nProvider';
import { NewLookSelect } from '../layout/NewLookSelect';

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
      <p>{t('students.reEnrol.description')}</p>
      {needsBranch ? (
        <div className="u8n-dd-field">
          <NewLookSelect
            id="re-enrol-branch"
            label={t('students.invite.homeBranch')}
            value={branchId}
            onChange={setBranchId}
            options={[{ value: '', label: t('students.invite.branchPlaceholder') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
          />
        </div>
      ) : null}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={confirm} loading={enrol.isPending}>
          {t('students.reEnrol.confirm')}
        </Button>
      </ModalActions>
    </Modal>
  );
}
