import { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { instructorSelectOptions, useInstructors } from '../instructors/instructorQueries';
import { useT } from '../i18n/I18nProvider';
import { useRemoveFromSchool, useStaffTeaching, type RemoveFromSchoolInput } from './roleGrantQueries';

type Choice = NonNullable<RemoveFromSchoolInput['classes']>;
const CHOICES = [
  { value: 'REASSIGN', label: 'roleGrants.list.choiceReassign', desc: 'roleGrants.list.choiceReassignDesc' },
  { value: 'NONE', label: 'roleGrants.list.choiceNone', desc: 'roleGrants.list.choiceNoneDesc' },
  { value: 'CANCEL', label: 'roleGrants.list.choiceCancel', desc: 'roleGrants.list.choiceCancelDesc' },
] as const satisfies ReadonlyArray<{ value: Choice; label: string; desc: string }>;

/**
 * "Remove from School" (Decision 361). The removal always goes ahead; when the
 * person still teaches here, the owner first chooses what happens to their
 * upcoming classes and weekly slots (product owner, 28 Oct 2026): another
 * coach, no coach for now, or cancel the classes. Option cards, since each
 * choice needs a line of explanation (DESIGN.md "Choices"). The coach picker
 * lists active, unarchived instructors other than this person, the same list
 * "Hand over classes" uses; the API checks each class's branch.
 */
export function RemoveFromSchoolModal({
  schoolId,
  userId,
  name,
  description,
  onClose,
}: {
  schoolId: string;
  userId: string;
  name: string;
  description: string;
  onClose: () => void;
}) {
  const t = useT();
  const teaching = useStaffTeaching(schoolId, userId);
  const instructors = useInstructors(schoolId);
  const remove = useRemoveFromSchool(schoolId);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [toUserId, setToUserId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const classes = teaching.data?.upcomingClasses ?? 0;
  const slots = teaching.data?.activeSlots ?? 0;
  const teaches = classes + slots > 0;
  const others = (instructors.data?.items ?? []).filter((i) => i.userId !== userId);
  const coachOptions = instructorSelectOptions(others, { archived: t('instructors.pickerArchived'), revoked: t('instructors.pickerRevoked') });
  const ready = !teaching.isLoading && (!teaches || (choice !== null && (choice !== 'REASSIGN' || !!toUserId)));

  async function confirm() {
    setError(null);
    try {
      await remove.mutateAsync({
        userId,
        body: teaches && choice ? { classes: choice, ...(choice === 'REASSIGN' ? { toUserId } : {}) } : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('roleGrants.list.removeFailed'));
      // What they teach may have changed meanwhile; ask again with fresh counts.
      void teaching.refetch();
    }
  }

  return (
    <Modal title={t('roleGrants.list.removeTitle', { name })} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ marginTop: 0 }}>{description}</p>
      {teaching.isLoading ? <Spinner /> : null}
      {teaching.error ? <ErrorBanner message={t('roleGrants.list.teachingLoadFailed')} /> : null}
      {teaches ? (
        <>
          <p>{t('roleGrants.list.teachingIntro', { name, classes, slots })}</p>
          <div
            className="ultm8-option-cards ultm8-field"
            role="radiogroup"
            aria-label={t('roleGrants.list.teachingChoiceAria')}
            style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
          >
            {CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={choice === c.value}
                className="ultm8-option-card"
                onClick={() => setChoice(c.value)}
              >
                {t(c.label)}
                <span className="ultm8-option-card__desc">{t(c.desc)}</span>
              </button>
            ))}
          </div>
          {choice === 'REASSIGN' ? (
            <Field label={t('roleGrants.list.reassignTo')} htmlFor="remove-reassign-to">
              <SelectField
                id="remove-reassign-to"
                value={toUserId}
                onChange={(e) => setToUserId(e.target.value)}
                options={[{ value: '', label: t('roleGrants.list.reassignPlaceholder') }, ...coachOptions]}
              />
            </Field>
          ) : null}
        </>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="danger" onClick={confirm} loading={remove.isPending} disabled={!ready}>
          {t('roleGrants.list.removeFromSchool')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
