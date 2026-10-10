import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import { type Rung, startingClassesFor } from './ladder';
import {
  useChangeHistoryNote,
  useHistoryNoteLog,
  type Eligibility,
  useDowngrade,
  useEditRankDate,
  usePromote,
  useStripeAward,
  useLogClass,
  useVerifyRank,
  useVoidEntry,
} from './gradingQueries';

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong — please try again.';
}

/** Today in the browser's local time, as YYYY-MM-DD (the date input's max).
 * The API checks the date again in the student's own time zone. */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Actions({ submitting, disabled, label, onClose }: { submitting: boolean; disabled?: boolean; label: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
      <Button type="submit" loading={submitting} disabled={disabled}>
        {label}
      </Button>
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p role="note" style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 8, background: 'var(--bg-warning)', color: 'var(--text-warning)' }}>
      {children}
    </p>
  );
}

/**
 * Grade a student up (Decisions 127, 128, 174): to any higher rung, so rungs
 * can be skipped (recorded on the history); optionally back-dated; with
 * starting classes toward the new next rung; and with the skills check —
 * blocked when the style requires every skill signed off, otherwise allowed
 * with an acknowledgement that is recorded. The next stripe of the same belt
 * is recorded as a stripe award; anything else as a promotion.
 */
export function GradeModal({
  studentId,
  discipline,
  ladder,
  current,
  eligibility,
  onClose,
}: {
  studentId: string;
  discipline: DisciplineResponse;
  ladder: Rung[];
  current: Rung | null;
  eligibility: Eligibility | null;
  onClose: () => void;
}) {
  const promote = usePromote(studentId, discipline.id);
  const stripeAward = useStripeAward(studentId, discipline.id);
  const options = ladder.filter((r) => !current || r.index > current.index);
  const [targetId, setTargetId] = useState(
    (eligibility?.hasNext && eligibility.nextRungId && options.some((r) => r.id === eligibility.nextRungId) ? eligibility.nextRungId : options[0]?.id) ?? '',
  );
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [startingTotal, setStartingTotal] = useState('');
  const [startingByType, setStartingByType] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = options.find((r) => r.id === targetId) ?? null;
  const isNextStripe = !!current && !!target && target.index === current.index + 1 && target.rankId === current.rankId;
  const skipped = current && target ? target.index - current.index - 1 : 0;
  const starting = target ? startingClassesFor(ladder, target) : { kind: 'NONE' as const };
  const missingSkills = current && eligibility?.hasNext && !eligibility.timeOnly ? eligibility.missingSkillIds ?? [] : [];
  const blockedBySkills = missingSkills.length > 0 && discipline.skillsRequiredToGrade;
  const needsAck = missingSkills.length > 0 && !discipline.skillsRequiredToGrade;
  const daysShort = current && eligibility?.hasNext && eligibility.daysOk === false ? (eligibility.requiredDays ?? 0) - (eligibility.elapsedDays ?? 0) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);
    // The rung the coach is looking at: refused if someone else graded first (Decision 185).
    const body: Parameters<typeof promote.mutateAsync>[0] = { acknowledgeWithoutSkillSignoff: needsAck, expectedCurrentRungId: current?.id ?? null };
    if (date && date !== todayLocal()) body.effectiveDate = date;
    if (note.trim()) body.note = note.trim();
    if (starting.kind === 'TOTAL' && startingTotal !== '') body.startingClasses = Number(startingTotal);
    if (starting.kind === 'BY_TYPE') {
      const byType: Record<string, number> = {};
      for (const t of starting.classTypes) if (startingByType[t]) byType[t] = Number(startingByType[t]);
      if (Object.keys(byType).length > 0) body.startingClassesByType = byType;
    }
    try {
      if (isNextStripe) await stripeAward.mutateAsync(body);
      else await promote.mutateAsync({ ...body, targetRungId: target.id });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Modal title={current ? `Grade — ${discipline.name}` : `Give a first rank — ${discipline.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        {options.length === 0 ? (
          <p>This student is already at the top of the ladder.</p>
        ) : (
          <>
            <Field label="New rank" htmlFor="grade-target" hint={current ? `Now: ${current.name}` : undefined}>
              <SelectField
                id="grade-target"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                options={options.map((r) => ({ value: r.id, label: r.name }))}
              />
            </Field>
            {skipped > 0 ? (
              <Warning>
                Skips {skipped} rank{skipped > 1 ? 's' : ''} in between. This is recorded on the history.
              </Warning>
            ) : null}
            {blockedBySkills ? (
              <Warning>
                This style requires every skill for the next rank to be signed off before grading. {missingSkills.length} skill
                {missingSkills.length > 1 ? 's are' : ' is'} not signed off yet.
              </Warning>
            ) : null}
            {daysShort > 0 ? (
              <Warning>
                {daysShort} day{daysShort > 1 ? 's' : ''} short of the minimum time at this rank.
              </Warning>
            ) : null}
            <Field label="Grading date" htmlFor="grade-date" hint="Leave empty for today. It can't be in the future or before the current rank's date.">
              <TextField id="grade-date" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {starting.kind === 'TOTAL' ? (
              <Field label="Starting classes" htmlFor="grade-starting" hint="Classes already counted toward the rank after this one. Usually 0.">
                <TextField id="grade-starting" type="number" min={0} step={1} value={startingTotal} onChange={(e) => setStartingTotal(e.target.value)} />
              </Field>
            ) : null}
            {starting.kind === 'BY_TYPE' ? (
              <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
                <legend className="ultm8-field__label">Starting classes, per class type</legend>
                {starting.classTypes.map((t) => (
                  <Field key={t} label={t} htmlFor={`grade-starting-${t}`}>
                    <TextField
                      id={`grade-starting-${t}`}
                      type="number"
                      min={0}
                      step={1}
                      value={startingByType[t] ?? ''}
                      onChange={(e) => setStartingByType((s) => ({ ...s, [t]: e.target.value }))}
                    />
                  </Field>
                ))}
              </fieldset>
            ) : null}
            <Field label="Note" htmlFor="grade-note" hint="Optional. Shown on the student's history.">
              <TextArea id="grade-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {needsAck ? (
              <Checkbox
                label={`Grade without all skills signed off (${missingSkills.length} missing). This is recorded on the history.`}
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
            ) : null}
          </>
        )}
        <Actions
          submitting={promote.isPending || stripeAward.isPending}
          disabled={!target || blockedBySkills || (needsAck && !acknowledged)}
          label={isNextStripe ? 'Award stripe' : 'Grade'}
          onClose={onClose}
        />
      </form>
    </Modal>
  );
}

/** Move a student down (Decision 128, item 11): to any lower rung, dated today,
 * with a required reason. Default: the first rung of the previous belt, as the
 * API's own default. */
export function DowngradeModal({
  studentId,
  discipline,
  ladder,
  current,
  onClose,
}: {
  studentId: string;
  discipline: DisciplineResponse;
  ladder: Rung[];
  current: Rung;
  onClose: () => void;
}) {
  const downgrade = useDowngrade(studentId, discipline.id);
  const options = ladder.filter((r) => r.index < current.index);
  const previousBelt = ladder.find((r) => r.rank.order === current.rank.order - 1);
  const [targetId, setTargetId] = useState(previousBelt?.id ?? options[options.length - 1]?.id ?? '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await downgrade.mutateAsync({
        acknowledgeWithoutSkillSignoff: false,
        targetRungId: targetId,
        expectedCurrentRungId: current.id,
        reason: reason.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Modal title={`Move down — ${discipline.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="New rank" htmlFor="downgrade-target" hint={`Now: ${current.name}. Dated today; counting starts again from zero.`}>
          <SelectField
            id="downgrade-target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            options={options.map((r) => ({ value: r.id, label: r.name }))}
          />
        </Field>
        <Field label="Reason" htmlFor="downgrade-reason" hint="Required. Shown on the student's history.">
          <TextArea id="downgrade-reason" required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="downgrade-note" hint="Optional.">
          <TextArea id="downgrade-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Actions submitting={downgrade.isPending} disabled={!targetId || !reason.trim()} label="Move down" onClose={onClose} />
      </form>
    </Modal>
  );
}

/** Correct the date the student reached their current rank (Decisions 153, 166). */
export function RankDateModal({
  studentId,
  discipline,
  currentDay,
  onClose,
}: {
  studentId: string;
  discipline: DisciplineResponse;
  currentDay: string;
  onClose: () => void;
}) {
  const edit = useEditRankDate(studentId, discipline.id);
  const [date, setDate] = useState(currentDay);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await edit.mutateAsync({ date, ...(note.trim() ? { note: note.trim() } : {}) });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Modal title={`Correct rank date — ${discipline.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Date reached this rank" htmlFor="rank-date" hint="Not in the future, and not before the previous grading. The change is recorded on the history.">
          <TextField id="rank-date" type="date" required max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="rank-date-note" hint="Optional.">
          <TextArea id="rank-date-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Actions submitting={edit.isPending} disabled={!date || date === currentDay} label="Save date" onClose={onClose} />
      </form>
    </Modal>
  );
}

/** Void a history entry with a reason (Decision 129): hidden from the normal
 * history, kept with who voided it, when and why. */
export function VoidEntryModal({
  studentId,
  schoolId,
  eventId,
  summary,
  onClose,
}: {
  studentId: string;
  schoolId: string;
  eventId: string;
  summary: string;
  onClose: () => void;
}) {
  const voidEntry = useVoidEntry(studentId, schoolId);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await voidEntry.mutateAsync({ eventId, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Modal title="Void history entry" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p style={{ marginTop: 0 }}>{summary}</p>
        <p className="ultm8-field__hint">Voiding hides this entry from the history. It doesn't change the student's current rank.</p>
        <Field label="Reason" htmlFor="void-reason" hint="Required.">
          <TextArea id="void-reason" required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Actions submitting={voidEntry.isPending} disabled={!reason.trim()} label="Void entry" onClose={onClose} />
      </form>
    </Modal>
  );
}

/** Verify a self-declared rank, or correct it to the right rung while
 * verifying (Decisions 137, 147). */
export function VerifyRankModal({
  studentId,
  discipline,
  ladder,
  current,
  onClose,
}: {
  studentId: string;
  discipline: DisciplineResponse;
  ladder: Rung[];
  current: Rung;
  onClose: () => void;
}) {
  const verify = useVerifyRank(studentId, discipline.id);
  const [targetId, setTargetId] = useState(current.id);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const target = ladder.find((r) => r.id === targetId) ?? current;
  const corrected = target.id !== current.id;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await verify.mutateAsync({
        ...(corrected ? { rankId: target.rankId, stripeTierId: target.id } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Modal title={`Verify rank — ${discipline.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Rank" htmlFor="verify-target" hint={`Declared by the student: ${current.name}. Pick another rank to correct it; the correction is recorded.`}>
          <SelectField id="verify-target" value={targetId} onChange={(e) => setTargetId(e.target.value)} options={ladder.map((r) => ({ value: r.id, label: r.name }))} />
        </Field>
        <Field label="Note" htmlFor="verify-note" hint="Optional.">
          <TextArea id="verify-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Actions submitting={verify.isPending} label={corrected ? 'Correct and verify' : 'Verify'} onClose={onClose} />
      </form>
    </Modal>
  );
}

/** "Log a class" (Decision 128 item 6, Decision 176): staff add one class by
 * hand. The class type is one of the next rank's ticked types (required when
 * it ticks any; optional, from the style's types, when it ticks none). It
 * always counts, even past the weekly cap, and is recorded on the history. */
export function LogClassModal({
  studentId,
  discipline,
  ladder,
  current,
  onClose,
}: {
  studentId: string;
  discipline: DisciplineResponse;
  ladder: Rung[];
  current: Rung;
  onClose: () => void;
}) {
  const logClass = useLogClass(discipline.id);
  const next = ladder[current.index + 1];
  const src = next && next.tier.timeOnly ? current : next;
  const ticked = src?.tier.eligibleClassTypes ?? [];
  const choices = ticked.length > 0 ? ticked : discipline.classTypesOffered;
  const [classType, setClassType] = useState(ticked.length > 0 ? ticked[0] : '');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await logClass.mutateAsync({ studentId, classType: classType || null });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Modal title={`Log a class — ${discipline.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        {choices.length > 0 ? (
          <Field
            label="Class type"
            htmlFor="log-class-type"
            hint={ticked.length > 0 ? 'One of the types that count toward the next rank.' : 'Optional: every class counts toward the next rank.'}
          >
            <SelectField
              value={classType}
              onChange={(e) => setClassType(e.target.value)}
              options={[...(ticked.length > 0 ? [] : [{ value: '', label: 'No class type' }]), ...choices.map((t) => ({ value: t, label: t }))]}
            />
          </Field>
        ) : null}
        <p className="ultm8-field__hint">Adds one class. It always counts, even past the weekly limit, and is recorded on the history.</p>
        <Actions submitting={logClass.isPending} label="Log class" onClose={onClose} />
      </form>
    </Modal>
  );
}

/** Edit a history entry's note (Decision 192). Every change is kept; the
 * School owner can read them. */
export function EditNoteModal({
  studentId,
  schoolId,
  eventId,
  summary,
  note,
  onClose,
}: {
  studentId: string;
  schoolId: string;
  eventId: string;
  summary: string;
  note: string | null;
  onClose: () => void;
}) {
  const change = useChangeHistoryNote(studentId, schoolId);
  const [text, setText] = useState(note ?? '');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await change.mutateAsync({ eventId, note: text.trim() || null });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Modal title="Edit note" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p style={{ marginTop: 0 }}>{summary}</p>
        <Field label="Note" htmlFor="history-note" hint="Leave empty to remove it. The change is recorded.">
          <TextArea id="history-note" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Actions submitting={change.isPending} disabled={text.trim() === (note ?? '')} label="Save note" onClose={onClose} />
      </form>
    </Modal>
  );
}

const CHANGE_LABEL = { EDITED: 'Edited', HIDDEN: 'Hidden from the student', SHOWN: 'Shown to the student again' } as const;

/** Every change to an entry's note, oldest first (Decision 192). Owner only. */
export function NoteLogModal({ studentId, schoolId, eventId, summary, onClose }: { studentId: string; schoolId: string; eventId: string; summary: string; onClose: () => void }) {
  const log = useHistoryNoteLog(studentId, schoolId, eventId);
  const items = log.data?.items ?? [];
  return (
    <Modal title="Note changes" onClose={onClose}>
      <p style={{ marginTop: 0 }}>{summary}</p>
      {log.error ? <ErrorBanner message={errorText(log.error)} /> : null}
      {!log.isLoading && items.length === 0 ? <p className="ultm8-field__hint">No changes yet.</p> : null}
      <ol aria-label="Note changes" style={{ paddingLeft: 20 }}>
        {items.map((c) => (
          <li key={c.id} style={{ marginBottom: 8 }}>
            <strong>{CHANGE_LABEL[c.change]}</strong> · {new Date(c.createdAt).toLocaleString()} · by {c.changedByName ?? 'Former staff'}
            {c.change === 'EDITED' ? (
              <div className="ultm8-field__hint">
                From “{c.oldNote ?? '(no note)'}” to “{c.newNote ?? '(no note)'}”
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <Button type="button" onClick={onClose}>
        Close
      </Button>
    </Modal>
  );
}
