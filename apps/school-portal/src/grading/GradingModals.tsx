import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import { type Rung, startingClassesFor } from './ladder';
import { RankPicker } from './RankPicker';
import {
  useChangeHistoryNote,
  useHistoryNoteLog,
  type Eligibility,
  useDowngrade,
  useEditRankDate,
  usePromote,
  useStripeAward,
  useLogClass,
  useRecentStyleClasses,
  useVerifyRank,
  useVoidEntry,
} from './gradingQueries';
import { useT, type TranslateFn, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { formatHours } from './hours';

function errorText(err: unknown, t: TranslateFn): string {
  return err instanceof ApiError ? err.message : t('common.tryAgain');
}

/** Today in the browser's local time, as YYYY-MM-DD (the date input's max).
 * The API checks the date again in the student's own time zone. */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Actions({ submitting, disabled, label, onClose }: { submitting: boolean; disabled?: boolean; label: string; onClose: () => void }) {
  const t = useT();
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
      <Button type="submit" loading={submitting} disabled={disabled}>
        {label}
      </Button>
      <Button type="button" variant="secondary" onClick={onClose}>
        {t('common.cancel')}
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
  title,
  initialTargetId,
  onClose,
}: {
  studentId: string;
  discipline: DisciplineResponse;
  ladder: Rung[];
  current: Rung | null;
  eligibility: Eligibility | null;
  /** The board's "Promote {name}"; the Ranks tab names the style instead. */
  title?: string;
  /** Start on this rank, e.g. the planned rank of a promotion "to decide". */
  initialTargetId?: string;
  onClose: () => void;
}) {
  const promote = usePromote(studentId, discipline.id);
  const stripeAward = useStripeAward(studentId, discipline.id);
  const t = useT();
  const options = ladder.filter((r) => !current || r.index > current.index);
  const [targetId, setTargetId] = useState(
    (initialTargetId && options.some((r) => r.id === initialTargetId) ? initialTargetId : undefined) ??
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
      for (const type of starting.classTypes) if (startingByType[type]) byType[type] = Number(startingByType[type]);
      if (Object.keys(byType).length > 0) body.startingClassesByType = byType;
    }
    try {
      if (isNextStripe) await stripeAward.mutateAsync(body);
      else await promote.mutateAsync({ ...body, targetRungId: target.id });
      onClose();
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <Modal
      title={title ?? (current ? t('grading.modals.grade.title', { style: discipline.name }) : t('grading.modals.grade.firstRankTitle', { style: discipline.name }))}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        {options.length === 0 ? (
          <p>{t('grading.modals.grade.atTop')}</p>
        ) : (
          <>
            <Field label={t('grading.modals.newRankLabel')} htmlFor="grade-target" hint={current ? t('grading.modals.grade.now', { rank: current.name }) : undefined}>
              <RankPicker id="grade-target" value={targetId} onChange={setTargetId} options={options} />
            </Field>
            {skipped > 0 ? (
              <Warning>{t('grading.modals.grade.skips', { count: skipped })}</Warning>
            ) : null}
            {blockedBySkills ? (
              <Warning>{t('grading.modals.grade.blockedBySkills', { count: missingSkills.length })}</Warning>
            ) : null}
            {daysShort > 0 ? (
              <Warning>{t('grading.modals.grade.daysShort', { count: daysShort })}</Warning>
            ) : null}
            <Field label={t('grading.modals.grade.dateLabel')} htmlFor="grade-date" hint={t('grading.modals.grade.dateHint')}>
              <TextField id="grade-date" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {starting.kind === 'TOTAL' ? (
              <Field label={t('grading.modals.grade.startingLabel')} htmlFor="grade-starting" hint={t('grading.modals.grade.startingHint')}>
                <TextField id="grade-starting" type="number" min={0} step={1} value={startingTotal} onChange={(e) => setStartingTotal(e.target.value)} />
              </Field>
            ) : null}
            {starting.kind === 'BY_TYPE' ? (
              <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
                <legend className="ultm8-field__label">{t('grading.modals.grade.startingByTypeLegend')}</legend>
                {starting.classTypes.map((type) => (
                  <Field key={type} label={type} htmlFor={`grade-starting-${type}`}>
                    <TextField
                      id={`grade-starting-${type}`}
                      type="number"
                      min={0}
                      step={1}
                      value={startingByType[type] ?? ''}
                      onChange={(e) => setStartingByType((s) => ({ ...s, [type]: e.target.value }))}
                    />
                  </Field>
                ))}
              </fieldset>
            ) : null}
            <Field label={t('grading.modals.noteLabel')} htmlFor="grade-note" hint={t('grading.modals.grade.noteHint')}>
              <TextArea id="grade-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {needsAck ? (
              <Checkbox
                label={t('grading.modals.grade.acknowledge', { count: missingSkills.length })}
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
            ) : null}
          </>
        )}
        <Actions
          submitting={promote.isPending || stripeAward.isPending}
          disabled={!target || blockedBySkills || (needsAck && !acknowledged)}
          label={isNextStripe ? t('grading.modals.grade.awardStripe') : t('grading.modals.grade.submit')}
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
  const t = useT();
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
      setError(errorText(err, t));
    }
  }

  return (
    <Modal title={t('grading.modals.downgrade.title', { style: discipline.name })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('grading.modals.newRankLabel')} htmlFor="downgrade-target" hint={t('grading.modals.downgrade.hint', { rank: current.name })}>
          <RankPicker id="downgrade-target" value={targetId} onChange={setTargetId} options={options} />
        </Field>
        <Field label={t('grading.modals.reasonLabel')} htmlFor="downgrade-reason" hint={t('grading.modals.downgrade.reasonHint')}>
          <TextArea id="downgrade-reason" required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t('grading.modals.noteLabel')} htmlFor="downgrade-note" hint={t('grading.modals.optional')}>
          <TextArea id="downgrade-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Actions submitting={downgrade.isPending} disabled={!targetId || !reason.trim()} label={t('grading.modals.downgrade.submit')} onClose={onClose} />
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
  const t = useT();
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
      setError(errorText(err, t));
    }
  }

  return (
    <Modal title={t('grading.modals.rankDate.title', { style: discipline.name })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('grading.modals.rankDate.dateLabel')} htmlFor="rank-date" hint={t('grading.modals.rankDate.dateHint')}>
          <TextField id="rank-date" type="date" required max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('grading.modals.noteLabel')} htmlFor="rank-date-note" hint={t('grading.modals.optional')}>
          <TextArea id="rank-date-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Actions submitting={edit.isPending} disabled={!date || date === currentDay} label={t('grading.modals.rankDate.submit')} onClose={onClose} />
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
  const t = useT();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await voidEntry.mutateAsync({ eventId, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <Modal title={t('grading.modals.void.title')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p style={{ marginTop: 0 }}>{summary}</p>
        <p className="ultm8-field__hint">{t('grading.modals.void.explanation')}</p>
        <Field label={t('grading.modals.reasonLabel')} htmlFor="void-reason" hint={t('grading.modals.void.reasonHint')}>
          <TextArea id="void-reason" required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Actions submitting={voidEntry.isPending} disabled={!reason.trim()} label={t('grading.modals.void.submit')} onClose={onClose} />
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
  const t = useT();
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
      setError(errorText(err, t));
    }
  }

  return (
    <Modal title={t('grading.modals.verify.title', { style: discipline.name })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('grading.modals.verify.rankLabel')} htmlFor="verify-target" hint={t('grading.modals.verify.hint', { rank: current.name })}>
          <RankPicker id="verify-target" value={targetId} onChange={setTargetId} options={ladder} />
        </Field>
        <Field label={t('grading.modals.noteLabel')} htmlFor="verify-note" hint={t('grading.modals.optional')}>
          <TextArea id="verify-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Actions submitting={verify.isPending} label={corrected ? t('grading.modals.verify.correctAndVerify') : t('grading.modals.verify.submit')} onClose={onClose} />
      </form>
    </Modal>
  );
}

/** "Log a class" (Decisions 176, 301 item 5): adds one class toward the next
 * rank, and its time to hours trained (a record only, never the %). The
 * coach picks a class of this style from the last week, whose length is
 * logged, or "No class" and enters the minutes. */
export function LogClassModal({
  studentId,
  schoolId,
  discipline,
  ladder,
  current,
  onClose,
}: {
  studentId: string;
  schoolId: string;
  discipline: DisciplineResponse;
  ladder: Rung[];
  current: Rung;
  onClose: () => void;
}) {
  const logClass = useLogClass(discipline.id);
  const classes = useRecentStyleClasses(schoolId, discipline.id);
  const t = useT();
  const next = ladder[current.index + 1];
  const src = next && next.tier.timeOnly ? current : next;
  const ticked = src?.tier.eligibleClassTypes ?? [];
  const choices = ticked.length > 0 ? ticked : discipline.classTypesOffered;
  const [classType, setClassType] = useState(ticked.length > 0 ? ticked[0] : '');
  const [mode, setMode] = useState<'class' | 'time'>('class');
  const [classId, setClassId] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [error, setError] = useState<string | null>(null);
  const list = classes.data ?? [];
  // No class of this style in the last week: only "No class" is left.
  const byTime = mode === 'time' || (!classes.isLoading && list.length === 0);
  const picked = byTime ? null : list.find((c) => c.id === (classId || list[0]?.id)) ?? null;
  const pickedMinutes = picked ? Math.max(0, Math.round((Date.parse(picked.endDate) - Date.parse(picked.startDate)) / 60_000)) : null;
  const typedMinutes = Number(minutes);
  const minutesOk = Number.isInteger(typedMinutes) && typedMinutes >= 1 && typedMinutes <= 600;
  const loggedMinutes = picked ? pickedMinutes ?? 0 : minutesOk ? typedMinutes : null;

  function pickClass(id: string) {
    setClassId(id);
    // The class's own type for this style, when it is one the next rank counts.
    const type = list.find((c) => c.id === id)?.styles.find((st) => st.disciplineId === discipline.id)?.classType;
    if (type && choices.includes(type)) setClassType(type);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (byTime && !minutesOk) {
      setError(t('grading.modals.logClass.minutesInvalid'));
      return;
    }
    try {
      await logClass.mutateAsync({
        studentId,
        classType: classType || null,
        classId: picked?.id ?? null,
        minutes: byTime ? typedMinutes : null,
      });
      onClose();
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <Modal title={t('grading.modals.logClass.title', { style: discipline.name })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
          <legend className="ultm8-field__label" style={{ marginBottom: 6 }}>
            {t('grading.modals.logClass.whichLabel')}
          </legend>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input type="radio" name="log-class-mode" checked={!byTime} disabled={list.length === 0} onChange={() => setMode('class')} />
            {t('grading.modals.logClass.aClass')}
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="radio" name="log-class-mode" checked={byTime} onChange={() => setMode('time')} />
            {t('grading.modals.logClass.noClass')}
          </label>
        </fieldset>
        {!byTime ? (
          <Field label={t('grading.modals.logClass.classLabel')} htmlFor="log-class-class" hint={t('grading.modals.logClass.classHint')}>
            <SelectField
              value={picked?.id ?? ''}
              onChange={(e) => pickClass(e.target.value)}
              options={list.map((c) => ({ value: c.id, label: classLabel(c, t) }))}
            />
          </Field>
        ) : (
          <>
            {!classes.isLoading && list.length === 0 ? <p className="ultm8-field__hint">{t('grading.modals.logClass.noRecentClasses')}</p> : null}
            <Field label={t('grading.modals.logClass.minutesLabel')} htmlFor="log-class-minutes">
              <TextField type="number" step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
          </>
        )}
        {choices.length > 0 ? (
          <Field
            label={t('grading.modals.logClass.typeLabel')}
            htmlFor="log-class-type"
            hint={ticked.length > 0 ? t('grading.modals.logClass.typeHintTicked') : t('grading.modals.logClass.typeHintAny')}
          >
            <SelectField
              value={classType}
              onChange={(e) => setClassType(e.target.value)}
              options={[...(ticked.length > 0 ? [] : [{ value: '', label: t('grading.modals.logClass.noType') }]), ...choices.map((type) => ({ value: type, label: type }))]}
            />
          </Field>
        ) : null}
        <p className="ultm8-field__hint">
          {loggedMinutes !== null
            ? t('grading.modals.logClass.explanation', { hours: formatHours(loggedMinutes) })
            : t('grading.modals.logClass.explanationNoTime')}
        </p>
        <Actions submitting={logClass.isPending} label={t('grading.modals.logClass.submit')} onClose={onClose} />
      </form>
    </Modal>
  );
}

/** "Adult Fundamentals · Mon 18:00 · 90 min". */
function classLabel(c: { title: string; startDate: string; endDate: string }, t: TranslateFn): string {
  const start = new Date(c.startDate);
  const when = new Intl.DateTimeFormat(formatLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(start);
  const minutes = Math.max(0, Math.round((Date.parse(c.endDate) - start.getTime()) / 60_000));
  return t('grading.modals.logClass.classOption', { title: c.title, when, minutes });
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
  const t = useT();
  const [text, setText] = useState(note ?? '');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await change.mutateAsync({ eventId, note: text.trim() || null });
      onClose();
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <Modal title={t('grading.modals.editNote.title')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p style={{ marginTop: 0 }}>{summary}</p>
        <Field label={t('grading.modals.noteLabel')} htmlFor="history-note" hint={t('grading.modals.editNote.hint')}>
          <TextArea id="history-note" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Actions submitting={change.isPending} disabled={text.trim() === (note ?? '')} label={t('grading.modals.editNote.submit')} onClose={onClose} />
      </form>
    </Modal>
  );
}

const CHANGE_LABEL: Record<'EDITED' | 'HIDDEN' | 'SHOWN', TranslationKey> = {
  EDITED: 'grading.modals.noteLog.changeEdited',
  HIDDEN: 'grading.modals.noteLog.changeHidden',
  SHOWN: 'grading.modals.noteLog.changeShown',
};

/** Every change to an entry's note, oldest first (Decision 192). Owner only. */
export function NoteLogModal({ studentId, schoolId, eventId, summary, onClose }: { studentId: string; schoolId: string; eventId: string; summary: string; onClose: () => void }) {
  const log = useHistoryNoteLog(studentId, schoolId, eventId);
  const t = useT();
  const items = log.data?.items ?? [];
  return (
    <Modal title={t('grading.modals.noteLog.title')} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{summary}</p>
      {log.error ? <ErrorBanner message={errorText(log.error, t)} /> : null}
      {!log.isLoading && items.length === 0 ? <p className="ultm8-field__hint">{t('grading.modals.noteLog.empty')}</p> : null}
      <ol aria-label={t('grading.modals.noteLog.title')} style={{ paddingLeft: 20 }}>
        {items.map((c) => (
          <li key={c.id} style={{ marginBottom: 8 }}>
            <strong>{t(CHANGE_LABEL[c.change])}</strong>{' '}
            {t('grading.modals.noteLog.meta', { date: new Date(c.createdAt).toLocaleString(formatLocale()), name: c.changedByName ?? t('grading.modals.noteLog.formerStaff') })}
            {c.change === 'EDITED' ? (
              <div className="ultm8-field__hint">
                {t('grading.modals.noteLog.fromTo', {
                  from: c.oldNote ?? t('grading.modals.noteLog.noNote'),
                  to: c.newNote ?? t('grading.modals.noteLog.noNote'),
                })}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <Button type="button" onClick={onClose}>
        {t('grading.modals.noteLog.close')}
      </Button>
    </Modal>
  );
}
