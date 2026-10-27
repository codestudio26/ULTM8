import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, useBranches } from '../branches/branchQueries';
import { useInviteStaff } from '../roleGrants/roleGrantQueries';
import { instructorName, instructorSelectOptions, useInstructors, useReassignInstructor, useResendInstructorPasscode, type InstructorResponse } from './instructorQueries';
import { useT } from '../i18n/I18nProvider';

/**
 * "Hand over classes" (Decision 312): every upcoming Class and active weekly
 * Timetable slot of this instructor goes to the one picked here, all or
 * nothing (POST /instructors/{id}/reassign). Only active, unarchived
 * instructors can be picked, the same rule as a Class's own picker.
 */
export function HandOverClassesModal({
  schoolId,
  instructor,
  onDone,
  onClose,
}: {
  schoolId: string;
  instructor: InstructorResponse;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { data } = useInstructors(schoolId);
  const reassign = useReassignInstructor(schoolId, instructor.id);
  const [toUserId, setToUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const others = (data?.items ?? []).filter((i) => i.userId !== instructor.userId);
  const options = instructorSelectOptions(others, { archived: t('instructors.pickerArchived'), revoked: t('instructors.pickerRevoked') });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const moved = await reassign.mutateAsync(toUserId);
      const to = others.find((i) => i.userId === toUserId);
      onDone(
        moved.classesMoved + moved.slotsMoved === 0
          ? t('instructors.detail.handOverNone')
          : t('instructors.detail.handOverDone', { classes: moved.classesMoved, slots: moved.slotsMoved, name: to ? instructorName(to) : '' }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('instructors.detail.handOverFailed'));
    }
  }

  return (
    <Modal title={t('instructors.detail.handOverTitle', { name: instructorName(instructor) })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p className="ultm8-field">{t('instructors.detail.handOverIntro')}</p>
        <Field label={t('instructors.detail.handOverTo')} htmlFor="hand-over-to">
          <SelectField
            id="hand-over-to"
            required
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            options={[{ value: '', label: t('instructors.detail.handOverPlaceholder') }, ...options]}
          />
        </Field>
        <Button type="submit" loading={reassign.isPending} disabled={!toUserId}>
          {t('instructors.detail.handOverConfirm')}
        </Button>
      </form>
    </Modal>
  );
}

/**
 * "Give Instructor role back" (Decision 312) for someone whose role was
 * revoked: the same grant the Staff page and "Invite to Instructor Role" make
 * (POST /users/{userId}/role-grants), at their profile's branch by default.
 * A School with branches needs one picked, the same rule as that invite.
 */
export function GiveRoleBackModal({
  schoolId,
  instructor,
  onDone,
  onClose,
}: {
  schoolId: string;
  instructor: InstructorResponse;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const { data: branchesData } = useBranches(schoolId);
  const branches = branchesData?.items ?? [];
  const invite = useInviteStaff();
  const [branchId, setBranchId] = useState(instructor.branchId ?? '');
  const [error, setError] = useState<string | null>(null);
  const requiresBranch = branches.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await invite.mutateAsync({
        targetUserId: instructor.userId,
        body: { role: 'INSTRUCTOR', schoolId, ...(branchId ? { branchId } : {}) },
      });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('instructors.detail.giveRoleBackFailed'));
    }
  }

  return (
    <Modal title={t('instructors.detail.giveRoleBackTitle', { name: instructorName(instructor) })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p className="ultm8-field">{t('instructors.detail.giveRoleBackDescription')}</p>
        {requiresBranch ? (
          <Field label={t('instructors.detail.giveRoleBackBranch')} htmlFor="give-role-back-branch">
            <SelectField
              id="give-role-back-branch"
              required
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={[{ value: '', label: t('instructors.inviteModal.branchPlaceholder') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
            />
          </Field>
        ) : null}
        <Button type="submit" loading={invite.isPending} disabled={requiresBranch && !branchId}>
          {t('instructors.detail.giveRoleBackConfirm')}
        </Button>
      </form>
    </Modal>
  );
}

/**
 * "Resend passcode" (Decision 331) for someone added manually who hasn't
 * signed in yet: a new temporary passcode is emailed and the old one stops
 * working (POST /instructors/{id}/resend-passcode).
 */
export function ResendPasscodeModal({
  instructor,
  onDone,
  onClose,
}: {
  instructor: InstructorResponse;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const resend = useResendInstructorPasscode(instructor.id);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setError(null);
    try {
      const { emailSent } = await resend.mutateAsync();
      onDone(emailSent ? t('instructors.detail.resendDone', { email: instructor.email }) : t('instructors.detail.resendEmailFailed'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('instructors.detail.resendFailed'));
    }
  }

  return (
    <Modal title={t('instructors.detail.resendTitle', { name: instructorName(instructor) })} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ marginTop: 0 }}>{t('instructors.detail.resendDescription', { email: instructor.email })}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={handleSend} loading={resend.isPending}>
          {t('instructors.detail.resendConfirm')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Shown instead of the revoke confirmation while the instructor still
 * teaches upcoming classes or weekly slots (Decision 331): the API refuses
 * that revoke, so this points straight to "Hand over classes".
 */
export function RevokeBlockedModal({
  instructor,
  onHandOver,
  onClose,
}: {
  instructor: InstructorResponse;
  onHandOver: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal title={t('instructors.detail.revokeBlockedTitle', { name: instructorName(instructor) })} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{t('instructors.detail.revokeBlockedDescription')}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={onHandOver}>{t('instructors.detail.handOver')}</Button>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
