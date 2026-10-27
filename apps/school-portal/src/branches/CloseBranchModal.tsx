import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useBranchClosePreview, useCloseBranch, type BranchListItem, type CloseBranchInput } from './branchQueries';

/** The API's "no Branch: the whole School" target (CloseBranchDto). */
const WHOLE_SCHOOL = 'WHOLE_SCHOOL';

type Group = 'classesTo' | 'studentsTo' | 'instructorsTo' | 'staffTo';

/**
 * Decision 330 — "Close branch". Shows what is still in use at the Branch
 * (upcoming classes and weekly slots, home-branch Students, Instructor
 * profiles, staff and coach roles), asks where each group goes, then moves
 * them and closes the Branch in one step. Past classes, bookings and
 * attendance stay with the closed Branch. A Branch with history is kept for
 * good; an empty one is removed after 90 days. Either can be reopened.
 */
export function CloseBranchModal({
  branch,
  schoolBranches,
  schoolId,
  onClose,
}: {
  branch: BranchListItem;
  /** Every Branch of the School, closed ones included. */
  schoolBranches: BranchListItem[];
  schoolId: string;
  onClose: () => void;
}) {
  const t = useT();
  const preview = useBranchClosePreview(branch.id);
  const closeBranch = useCloseBranch(schoolId);
  const [targets, setTargets] = useState<Partial<Record<Group, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const others = schoolBranches.filter((b) => b.id !== branch.id && !b.archivedAt).map((b) => ({ value: b.id, label: b.name }));
  const choose = { value: '', label: t('branches.close.choose') };
  const wholeSchool = { value: WHOLE_SCHOOL, label: t('branches.close.wholeSchool') };

  const p = preview.data;
  const groups: { key: Group; label: string; options: { value: string; label: string }[] }[] = p
    ? [
        ...(p.upcomingClasses + p.timetableSlots > 0
          ? [{ key: 'classesTo' as const, label: t('branches.close.classes', { classes: p.upcomingClasses, slots: p.timetableSlots }), options: [choose, ...others, wholeSchool] }]
          : []),
        ...(p.students > 0 ? [{ key: 'studentsTo' as const, label: t('branches.close.students', { count: p.students }), options: [choose, ...others, { value: WHOLE_SCHOOL, label: t('branches.close.noHomeBranch') }] }] : []),
        ...(p.instructors > 0 ? [{ key: 'instructorsTo' as const, label: t('branches.close.instructors', { count: p.instructors }), options: [choose, ...others, wholeSchool] }] : []),
        ...(p.staffRoles > 0 ? [{ key: 'staffTo' as const, label: t('branches.close.staff', { count: p.staffRoles }), options: [choose, ...others] }] : []),
      ]
    : [];
  // Staff and coach roles never become School-wide; with no other open
  // Branch they have to be removed on the Staff page first.
  const staffStuck = !!p && p.staffRoles > 0 && others.length === 0;
  const ready = !!p && !staffStuck && groups.every((g) => !!targets[g.key]);

  async function confirm() {
    setError(null);
    const body: CloseBranchInput = {};
    for (const g of groups) body[g.key] = targets[g.key];
    try {
      await closeBranch.mutateAsync({ branchId: branch.id, body });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('branches.archiveFailed'));
    }
  }

  return (
    <Modal title={t('branches.close.title', { name: branch.name })} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ marginTop: 0 }}>{t('branches.close.intro')}</p>
      {preview.isLoading ? <Spinner /> : null}
      {preview.error ? <ErrorBanner message={preview.error instanceof ApiError ? preview.error.message : t('branches.close.previewFailed')} /> : null}
      {p ? (
        <>
          {groups.length === 0 ? <p>{t('branches.close.nothingInUse')}</p> : <p>{t('branches.close.moveIntro')}</p>}
          {groups.map((g) =>
            g.key === 'staffTo' && staffStuck ? (
              <p key={g.key} data-testid="close-branch-staff-stuck">
                <strong>{g.label}</strong> — {t('branches.close.staffNoBranch')}
              </p>
            ) : (
              <Field key={g.key} label={g.label} htmlFor={`close-branch-${g.key}`}>
                <SelectField value={targets[g.key] ?? ''} onChange={(e) => setTargets((cur) => ({ ...cur, [g.key]: e.target.value || undefined }))} options={g.options} />
              </Field>
            ),
          )}
          {p.pendingCoachInvites > 0 ? <p>{t('branches.close.invites', { count: p.pendingCoachInvites })}</p> : null}
          <p>{p.hasHistory ? t('branches.close.keptForGood') : t('branches.close.removedAfter90Days')}</p>
          <p style={{ color: 'var(--ultm8-text-muted, inherit)' }}>{t('branches.close.noChargesNoEmails')}</p>
        </>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="danger" onClick={confirm} loading={closeBranch.isPending} disabled={!ready}>
          {t('branches.archive')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
