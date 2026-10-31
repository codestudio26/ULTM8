import React, { useMemo, useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { useStudents } from './studentQueries';
import { matchesSearch } from './studentSearch';
import { mergeGroupCounts, useMergeDuplicate, useMergePreview, type MergeBlocker, type MergeBlockerCode, type MergeGroup } from './memberMergeQueries';

const BLOCKER_KEYS: Record<MergeBlockerCode, TranslationKey> = {
  GUARDIANS_DIFFER: 'students.merge.blockers.guardiansDiffer',
  BOTH_UNLIMITED_MEMBERSHIPS: 'students.merge.blockers.bothUnlimited',
  DUPLICATE_HAS_SUBSCRIPTION: 'students.merge.blockers.duplicateSubscription',
  PENDING_CARD_PAYMENT: 'students.merge.blockers.pendingCardPayment',
  OPEN_PACK_RECHARGE: 'students.merge.blockers.openPackRecharge',
  SAME_STYLE_RANK: 'students.merge.blockers.sameStyleRank',
  SAME_STYLE_CORRECTION: 'students.merge.blockers.sameStyleCorrection',
  SAME_CLASS_BOOKED: 'students.merge.blockers.sameClassBooked',
  SAME_CLASS_WAITLIST: 'students.merge.blockers.sameClassWaitlist',
  OPEN_SIGN_UP: 'students.merge.blockers.openSignUp',
  PENDING_CHILD_INVITE: 'students.merge.blockers.pendingChildInvite',
};

const GROUP_KEYS: Record<MergeGroup, TranslationKey> = {
  memberships: 'students.merge.groups.memberships',
  payments: 'students.merge.groups.payments',
  bookings: 'students.merge.groups.bookings',
  grading: 'students.merge.groups.grading',
  waivers: 'students.merge.groups.waivers',
  notes: 'students.merge.groups.notes',
  tags: 'students.merge.groups.tags',
  files: 'students.merge.groups.files',
  more: 'students.merge.groups.more',
};

/** Shown at most, so a big School's list stays short; the search narrows it. */
const MAX_OPTIONS = 50;

/**
 * Merge a duplicate member into this one (Decision 315 item 13). The owner
 * picks the other record of the same person; the preview says what moves and
 * anything that stops it. Only this School's records move; the duplicate's
 * account and login, and anything they have at another School, are not
 * changed.
 */
export function MergeDuplicateModal({
  schoolId,
  keptId,
  keptName,
  onClose,
  onMerged,
}: {
  schoolId: string;
  keptId: string;
  keptName: string;
  onClose: () => void;
  onMerged: (message: string) => void;
}) {
  const t = useT();
  const students = useStudents(schoolId, 'ACTIVE');
  const [query, setQuery] = useState('');
  const [duplicateId, setDuplicateId] = useState('');
  const preview = useMergePreview(schoolId, keptId, duplicateId || null);
  const merge = useMergeDuplicate(schoolId, keptId);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () => (students.data?.items ?? []).filter((s) => s.id !== keptId && matchesSearch(s, query)).slice(0, MAX_OPTIONS),
    [students.data, keptId, query],
  );
  const chosen = (students.data?.items ?? []).find((s) => s.id === duplicateId);
  const duplicateName = preview.data?.duplicate.name ?? (chosen ? `${chosen.firstName} ${chosen.surname}`.trim() : '');
  const blockers = preview.data?.blockers ?? [];
  const groups = preview.data ? mergeGroupCounts(preview.data.records) : [];

  async function confirm() {
    setError(null);
    try {
      await merge.mutateAsync(duplicateId);
      onMerged(t('students.merge.done', { duplicate: duplicateName, kept: keptName }));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('students.merge.failed'));
    }
  }

  const blockerText = (b: MergeBlocker) => {
    const text = t(BLOCKER_KEYS[b.code]);
    const details = b.details.filter(Boolean);
    return details.length > 0 ? `${text} (${details.join(', ')})` : text;
  };

  return (
    <Modal title={t('students.merge.title', { name: keptName })} onClose={onClose} wide>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ marginTop: 0 }}>{t('students.merge.intro', { name: keptName })}</p>
      <Field label={t('students.merge.searchLabel')} htmlFor="merge-search">
        <TextField id="merge-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      {students.isLoading ? (
        <Spinner />
      ) : (
        <Field label={t('students.merge.duplicateLabel')} htmlFor="merge-duplicate" hint={t('students.merge.duplicateHint')}>
          <SelectField
            id="merge-duplicate"
            value={duplicateId}
            onChange={(e) => {
              setDuplicateId(e.target.value);
              setError(null);
            }}
            options={[
              { value: '', label: t('students.merge.choose') },
              ...(chosen && !candidates.some((c) => c.id === chosen.id) ? [chosen] : []).concat(candidates).map((s) => ({
                value: s.id,
                label: s.email ? `${s.firstName} ${s.surname} · ${s.email}` : `${s.firstName} ${s.surname}`,
              })),
            ]}
          />
        </Field>
      )}

      {duplicateId ? (
        preview.isLoading ? (
          <Spinner />
        ) : preview.error ? (
          <ErrorBanner message={preview.error instanceof ApiError ? preview.error.message : t('students.merge.previewFailed')} />
        ) : preview.data ? (
          <div data-testid="merge-preview">
            {blockers.length > 0 ? (
              <>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>{t('students.merge.blockedTitle')}</p>
                <ul style={{ marginTop: 0 }}>
                  {blockers.map((b) => (
                    <li key={b.code}>{blockerText(b)}</li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p style={{ marginBottom: 4 }}>{t('students.merge.moves', { duplicate: duplicateName, kept: keptName })}</p>
                {groups.length > 0 ? (
                  <ul style={{ marginTop: 0 }}>
                    {groups.map((g) => (
                      <li key={g.group}>{t(GROUP_KEYS[g.group], { count: g.count })}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ marginTop: 0 }}>{t('students.merge.nothingToMove')}</p>
                )}
                <p>{t('students.merge.afterwards', { duplicate: duplicateName })}</p>
                <p style={{ color: 'var(--text-secondary)' }}>{t('students.merge.waiverNote')}</p>
              </>
            )}
          </div>
        ) : null
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="danger" onClick={confirm} loading={merge.isPending} disabled={!preview.data || blockers.length > 0}>
          {t('students.merge.confirm')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('students.merge.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
