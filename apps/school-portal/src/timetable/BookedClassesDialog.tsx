import React, { useState } from 'react';
import { Button, ErrorBanner, Modal } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';
import type { UpcomingImpactResponse } from './timetableQueries';

export type BookedClassesChoice = 'MOVE' | 'CANCEL' | 'KEEP';

/** What the edit does to booked upcoming Classes, which decides the choices:
 * - `move`: day, times or branch change — Move, Cancel or Keep;
 * - `off`: the slot is switched off — Cancel or Keep (nowhere to move to);
 * - `rules`: booking rules change (waiver, membership, cut-offs, charge) —
 *   apply to booked classes too, or leave them (Decision 332, T6);
 * - `capacity`: only a capacity cut below seats booked — no choice, just
 *   confirm that fuller classes keep their size (Decision 332, T5). */
export type BookedClassesMode = 'move' | 'off' | 'rules' | 'capacity';

/**
 * Decisions 322, 332 — a slot edit that moves its Classes (day, times, branch),
 * switches it off, or changes their booking rules asks the owner what happens
 * to the upcoming Classes that already have bookings. Unbooked upcoming Classes
 * always follow the change, so they aren't a choice. A capacity cut below the
 * seats taken is never applied to a class it doesn't fit: that class keeps its
 * size, and the owner confirms that first.
 */
export function BookedClassesDialog({
  impact,
  mode,
  capacityCut,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  impact: UpcomingImpactResponse;
  mode: BookedClassesMode;
  capacityCut: boolean;
  submitting: boolean;
  error: string | null;
  onConfirm: (choice: BookedClassesChoice) => void;
  onClose: () => void;
}) {
  const t = useT();
  const options: BookedClassesChoice[] = { move: ['MOVE', 'CANCEL', 'KEEP'], off: ['CANCEL', 'KEEP'], rules: ['MOVE', 'KEEP'], capacity: [] }[mode] as BookedClassesChoice[];
  const [choice, setChoice] = useState<BookedClassesChoice>(options[0] ?? 'KEEP');
  const labels: Record<BookedClassesChoice, { name: string; description: string }> =
    mode === 'rules'
      ? {
          MOVE: { name: t('timetable.bookedClasses.applyRules'), description: t('timetable.bookedClasses.applyRulesDescription') },
          CANCEL: { name: t('timetable.bookedClasses.cancel'), description: t('timetable.bookedClasses.cancelDescription') },
          KEEP: { name: t('timetable.bookedClasses.keepRules'), description: t('timetable.bookedClasses.keepRulesDescription') },
        }
      : {
          MOVE: { name: t('timetable.bookedClasses.move'), description: t('timetable.bookedClasses.moveDescription') },
          CANCEL: { name: t('timetable.bookedClasses.cancel'), description: t('timetable.bookedClasses.cancelDescription') },
          KEEP: { name: t('timetable.bookedClasses.keep'), description: t('timetable.bookedClasses.keepDescription') },
        };
  return (
    <Modal title={t(mode === 'capacity' ? 'timetable.bookedClasses.capacityTitle' : 'timetable.bookedClasses.title')} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      {mode !== 'capacity' ? (
        <p>{t('timetable.bookedClasses.summary', { classes: impact.bookedClasses, students: impact.bookedStudents })}</p>
      ) : null}
      {capacityCut ? <p>{t('timetable.bookedClasses.capacityCut', { taken: impact.mostTaken })}</p> : null}
      {options.length > 0 ? (
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
      ) : null}
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
