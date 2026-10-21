import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from '../branches/branchQueries';
import type { InstructorResponse } from '../instructors/instructorQueries';
import { useI18n } from '../i18n/I18nProvider';
import type { TimetableSlotResponse } from './timetableQueries';
import { weekdayName } from './timetableOccurrences';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import { StylePicker, styleSelectionProblem, type StyleSelection } from '../disciplines/StylePicker';

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

export interface TimetableSlotFormValues {
  /** `null` means "cleared" — UpdateTimetableSlotDto accepts `null` on these
   * fields to mean exactly that (see that DTO's own header comment); the
   * page-level caller maps `null` back to `undefined` for the CREATE path,
   * which has nothing to clear. */
  branchId?: string | null;
  instructorId?: string | null;
  weekday: (typeof WEEKDAYS)[number];
  startTime: string;
  endTime: string;
  /** NOT clearable via this form yet — TimetableService.update() converts
   * these via `dto.X ? parseHHmm(dto.X) : undefined`, a falsy check that
   * would treat an explicit `null` the same as an omitted field. A real,
   * separate, flagged backend gap (see that service's own comment), not
   * something this form can fix on its own. */
  breakStart?: string;
  breakEnd?: string;
  /** Always populated — defaults to 'ON', never undefined. */
  status: 'ON' | 'OFF';
  title: string;
  /** Free text, for a School with no styles. Omitted when styles are picked
   * (the API fills it in from the styles' names). */
  activities?: string[];
  /** For a School with styles (Decision 170); copied onto every generated Class. */
  styles?: StyleSelection[];
  capacity?: number | null;
  description?: string | null;
  bannerUrl?: string | null;
  /** Always populated — the checkboxes default to false, never undefined. */
  termsWaiverRequired: boolean;
  membershipInclusion: boolean;
  bookingCutoffMinutesBeforeStart?: number | null;
  qrAttendanceWindowMinutes?: number | null;
  refundCutoffHoursBeforeStart?: number | null;
  cancellationCharge?: number | null;
}

/** Fields match CreateTimetableSlotDto/UpdateTimetableSlotDto exactly —
 * apps/api/src/timetable/dto/create-timetable-slot.dto.ts. This is the
 * recurring weekly TEMPLATE (weekday + HH:mm times), a separate resource
 * from Class per that DTO's own header comment — Spec 55 doesn't confirm how
 * (or whether) a bookable Class gets generated from a slot occurrence, so
 * this screen manages the template only, same as the backend. `title`/
 * `activities`/etc. are template copies of the same fields CreateClassDto
 * has, kept in sync with that form's own field set and validation limits. */
export function TimetableSlotFormModal({
  title,
  initial,
  branches,
  instructors,
  disciplines,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<TimetableSlotResponse>;
  branches: BranchResponse[];
  instructors: InstructorResponse[];
  /** The School's styles (Decisions 143, 152, 170). */
  disciplines: DisciplineResponse[];
  submitting: boolean;
  onSubmit: (values: TimetableSlotFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState({
    branchId: initial?.branchId ?? '',
    instructorId: initial?.instructorId ?? '',
    weekday: (initial?.weekday as (typeof WEEKDAYS)[number]) ?? 'MONDAY',
    startTime: initial?.startTime ?? '18:00',
    endTime: initial?.endTime ?? '19:00',
    breakStart: initial?.breakStart ?? '',
    breakEnd: initial?.breakEnd ?? '',
    status: (initial?.status as 'ON' | 'OFF') ?? 'ON',
    title: initial?.title ?? '',
    activities: (initial?.activities ?? []).join(', '),
    capacity: initial?.capacity?.toString() ?? '',
    description: initial?.description ?? '',
    bannerUrl: initial?.bannerUrl ?? '',
    termsWaiverRequired: initial?.termsWaiverRequired ?? false,
    membershipInclusion: initial?.membershipInclusion ?? false,
    bookingCutoffMinutesBeforeStart: initial?.bookingCutoffMinutesBeforeStart?.toString() ?? '',
    qrAttendanceWindowMinutes: initial?.qrAttendanceWindowMinutes?.toString() ?? '',
    refundCutoffHoursBeforeStart: initial?.refundCutoffHoursBeforeStart?.toString() ?? '',
    cancellationCharge: initial?.cancellationCharge?.toString() ?? '',
  });
  const [styles, setStyles] = useState<StyleSelection[]>(
    initial?.styles?.length ? initial.styles.map((s) => ({ disciplineId: s.disciplineId, classType: s.classType ?? null })) : [{ disciplineId: '', classType: null }],
  );
  const usesStyles = disciplines.length > 0;
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // FOUND ON REVIEW: `required` on the raw Activities input only guarantees
    // non-empty TEXT (e.g. "," alone passes) — validate the actual parsed
    // array, which is what CreateTimetableSlotDto's own ArrayMinSize(1)
    // enforces.
    const activities = form.activities
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (usesStyles) {
      const problem = styleSelectionProblem(disciplines, styles, t);
      if (problem) {
        setError(problem);
        return;
      }
    } else if (activities.length === 0) {
      setError(t('timetable.form.activitiesRequired'));
      return;
    }
    if (form.endTime <= form.startTime) {
      setError(t('timetable.form.endAfterStart'));
      return;
    }
    try {
      await onSubmit({
        branchId: form.branchId || null,
        instructorId: form.instructorId || null,
        weekday: form.weekday,
        startTime: form.startTime,
        endTime: form.endTime,
        breakStart: form.breakStart || undefined,
        breakEnd: form.breakEnd || undefined,
        status: form.status,
        title: form.title,
        ...(usesStyles ? { styles } : { activities }),
        capacity: form.capacity ? Number(form.capacity) : null,
        description: form.description || null,
        bannerUrl: form.bannerUrl || null,
        termsWaiverRequired: form.termsWaiverRequired,
        membershipInclusion: form.membershipInclusion,
        bookingCutoffMinutesBeforeStart: form.bookingCutoffMinutesBeforeStart
          ? Number(form.bookingCutoffMinutesBeforeStart)
          : null,
        qrAttendanceWindowMinutes: form.qrAttendanceWindowMinutes ? Number(form.qrAttendanceWindowMinutes) : null,
        refundCutoffHoursBeforeStart: form.refundCutoffHoursBeforeStart
          ? Number(form.refundCutoffHoursBeforeStart)
          : null,
        cancellationCharge: form.cancellationCharge ? Number(form.cancellationCharge) : null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('timetable.form.titleLabel')} htmlFor="slot-title">
          <TextField required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        {usesStyles ? (
          <StylePicker idPrefix="slot" disciplines={disciplines} value={styles} onChange={setStyles} />
        ) : (
          <Field label={t('timetable.form.activitiesLabel')} htmlFor="slot-activities" hint={t('timetable.form.activitiesHint')}>
            <TextField
              required
              value={form.activities}
              onChange={(e) => setForm((f) => ({ ...f, activities: e.target.value }))}
            />
          </Field>
        )}
        <Field label={t('timetable.form.weekdayLabel')} htmlFor="slot-weekday">
          <SelectField
            value={form.weekday}
            onChange={(e) => setForm((f) => ({ ...f, weekday: e.target.value as (typeof WEEKDAYS)[number] }))}
            options={WEEKDAYS.map((w) => ({ value: w, label: weekdayName(w, locale, 'long') }))}
          />
        </Field>
        <Field label={t('timetable.form.startTimeLabel')} htmlFor="slot-startTime" hint={t('timetable.form.timeHint')}>
          <TextField
            required
            type="time"
            value={form.startTime}
            onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
          />
        </Field>
        <Field label={t('timetable.form.endTimeLabel')} htmlFor="slot-endTime" hint={t('timetable.form.timeHint')}>
          <TextField
            required
            type="time"
            value={form.endTime}
            onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
          />
        </Field>
        <Field
          label={t('timetable.form.breakStartLabel')}
          htmlFor="slot-breakStart"
          hint={initial?.breakStart ? t('timetable.form.cantClearHint') : undefined}
        >
          <TextField type="time" value={form.breakStart} onChange={(e) => setForm((f) => ({ ...f, breakStart: e.target.value }))} />
        </Field>
        <Field
          label={t('timetable.form.breakEndLabel')}
          htmlFor="slot-breakEnd"
          hint={initial?.breakEnd ? t('timetable.form.cantClearHint') : undefined}
        >
          <TextField type="time" value={form.breakEnd} onChange={(e) => setForm((f) => ({ ...f, breakEnd: e.target.value }))} />
        </Field>
        <Field label={t('timetable.form.statusLabel')} htmlFor="slot-status">
          <SelectField
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'ON' | 'OFF' }))}
            options={[
              { value: 'ON', label: t('timetable.form.statusOn') },
              { value: 'OFF', label: t('timetable.form.statusOff') },
            ]}
          />
        </Field>
        <Field label={t('timetable.form.branchLabel')} htmlFor="slot-branch" hint={t('timetable.form.branchHint')}>
          <SelectField
            value={form.branchId}
            onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
            options={[{ value: '', label: t('timetable.form.wholeSchool') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </Field>
        <Field label={t('timetable.form.instructorLabel')} htmlFor="slot-instructor">
          <SelectField
            value={form.instructorId}
            onChange={(e) => setForm((f) => ({ ...f, instructorId: e.target.value }))}
            options={[
              { value: '', label: t('timetable.form.unassigned') },
              ...instructors.map((i) => ({ value: i.userId, label: `${i.firstName} ${i.surname}`.trim() })),
            ]}
          />
        </Field>
        <Field label={t('timetable.form.capacityLabel')} htmlFor="slot-capacity" hint={t('timetable.form.capacityHint')}>
          <TextField type="number" min={1} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
        </Field>
        <Field label={t('timetable.form.bookingCutoffLabel')} htmlFor="slot-bookingCutoff" hint={t('timetable.form.bookingCutoffHint')}>
          <TextField
            type="number"
            min={0}
            value={form.bookingCutoffMinutesBeforeStart}
            onChange={(e) => setForm((f) => ({ ...f, bookingCutoffMinutesBeforeStart: e.target.value }))}
          />
        </Field>
        <Field label={t('timetable.form.qrWindowLabel')} htmlFor="slot-qrWindow" hint={t('timetable.form.qrWindowHint')}>
          <TextField
            type="number"
            min={0}
            value={form.qrAttendanceWindowMinutes}
            onChange={(e) => setForm((f) => ({ ...f, qrAttendanceWindowMinutes: e.target.value }))}
          />
        </Field>
        <Field label={t('timetable.form.refundCutoffLabel')} htmlFor="slot-refundCutoff" hint={t('timetable.form.refundCutoffHint')}>
          <TextField
            type="number"
            min={0}
            value={form.refundCutoffHoursBeforeStart}
            onChange={(e) => setForm((f) => ({ ...f, refundCutoffHoursBeforeStart: e.target.value }))}
          />
        </Field>
        <Field label={t('timetable.form.cancellationChargeLabel')} htmlFor="slot-cancellationCharge" hint={t('timetable.form.cancellationChargeHint')}>
          <TextField
            type="number"
            min={0}
            value={form.cancellationCharge}
            onChange={(e) => setForm((f) => ({ ...f, cancellationCharge: e.target.value }))}
          />
        </Field>
        <Field label={t('timetable.form.bannerUrlLabel')} htmlFor="slot-banner">
          <TextField value={form.bannerUrl} onChange={(e) => setForm((f) => ({ ...f, bannerUrl: e.target.value }))} />
        </Field>
        <Field label={t('timetable.form.descriptionLabel')} htmlFor="slot-description">
          <TextArea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <Checkbox
          label={t('timetable.form.waiverRequired')}
          checked={form.termsWaiverRequired}
          onChange={(e) => setForm((f) => ({ ...f, termsWaiverRequired: e.target.checked }))}
        />
        <Checkbox
          label={t('timetable.form.membershipInclusion')}
          checked={form.membershipInclusion}
          onChange={(e) => setForm((f) => ({ ...f, membershipInclusion: e.target.checked }))}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            {t('common.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
