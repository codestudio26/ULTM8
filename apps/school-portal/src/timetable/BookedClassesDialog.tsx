import React, { useState } from 'react';
import { Button, ErrorBanner, Modal } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';
import type { UpcomingImpactResponse } from './timetableQueries';

export type BookedClassesChoice = 'MOVE' | 'CANCEL' | 'KEEP';

/**
 * Decision 322 — a slot edit that moves its Classes (day, times, branch),
 * switches it off, or cuts its capacity below the seats already taken, asks the
 * owner what happens to the upcoming Classes that already have bookings.
 * Unbooked upcoming Classes always follow the change, so they aren't a choice.
 * MOVE isn't offered when the slot is switched off (nowhere to move to) or when
 * the capacity cut is what triggered the question (the API refuses it then).
 */
export function BookedClassesDialog({
  impact,
  allowMove,
  capacityCut,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  impact: UpcomingImpactResponse;
  allowMove: boolean;
  capacityCut: boolean;
  submitting: boolean;
  error: string | null;
  onConfirm: (choice: BookedClassesChoice) => void;
  onClose: () => void;
}) {
  const t = useT();
  const options: BookedClassesChoice[] = allowMove ? ['MOVE', 'CANCEL', 'KEEP'] : ['CANCEL', 'KEEP'];
  const [choice, setChoice] = useState<BookedClassesChoice>(options[0]);
  const labels: Record<BookedClassesChoice, { name: string; description: string }> = {
    MOVE: { name: t('timetable.bookedClasses.move'), description: t('timetable.bookedClasses.moveDescription') },
    CANCEL: { name: t('timetable.bookedClasses.cancel'), description: t('timetable.bookedClasses.cancelDescription') },
    KEEP: { name: t('timetable.bookedClasses.keep'), description: t('timetable.bookedClasses.keepDescription') },
  };
  return (
    <Modal title={t('timetable.bookedClasses.title')} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p>
        {t('timetable.bookedClasses.summary', { classes: impact.bookedClasses, students: impact.bookedStudents })}
      </p>
      {capacityCut ? <p>{t('timetable.bookedClasses.capacityCut', { taken: impact.mostTaken })}</p> : null}
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
        <legend className="ultm8-field__label" style={{ marginBottom: 8 }}>
          {t('timetable.bookedClasses.legend')}
        </legend>
        {options.map((option) => (
          <label key={option} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10, cursor: 'pointer' }}>
            <input
              type="radio"
              name="bookedClasses"
              value={option}
              checked={choice === option}
              onChange={() => setChoice(option)}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>{labels[option].name}</strong>
              <br />
              <span style={{ color: 'var(--text-secondary)' }}>{labels[option].description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p style={{ color: 'var(--text-secondary)' }}>{t('timetable.bookedClasses.unbookedNote')}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="button" loading={submitting} onClick={() => onConfirm(choice)}>
          {t('timetable.bookedClasses.save')}
        </Button>
      </div>
    </Modal>
  );
}
