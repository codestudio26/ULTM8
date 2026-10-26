import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, PhotoUploadField, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, type BranchResponse } from '../branches/branchQueries';
import { instructorSelectOptions, type InstructorResponse } from '../instructors/instructorQueries';
import { isoToLocalInput, localInputToIso } from '../lib/datetime';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import type { ClassResponse } from './classQueries';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import { StylePicker, styleSelectionProblem, type StyleSelection } from '../disciplines/StylePicker';
import { useT } from '../i18n/I18nProvider';

export interface ClassFormValues {
  /**
   * `null` (not `undefined`) means "the field was cleared" — UpdateClassDto now
   * accepts `null` on these specific fields to mean exactly that (FOUND ON
   * REVIEW: an earlier draft used `undefined` for a cleared field, which
   * `openapi-fetch`'s JSON body serializer drops from the request entirely,
   * so ClassesService.update()'s own `dto.branchId !== undefined ? ... :
   * existing.branchId` read it as "unchanged" — the Owner could select "Whole
   * School"/"Unassigned"/blank a text field, get no error, and the old value
   * would silently stick). `ClassesPage` maps `null` back to `undefined` for
   * the CREATE path, where there's nothing to clear and CreateClassDto doesn't
   * accept `null` on these fields.
   */
  branchId?: string | null;
  instructorId?: string | null;
  title: string;
  /** Free text, for a School with no styles. Omitted when styles are picked
   * (the API fills it in from the styles' names). */
  activities?: string[];
  /** For a School with styles (Decision 170). */
  styles?: StyleSelection[];
  bannerUrl?: string | null;
  description?: string | null;
  startDate: string;
  endDate: string;
  capacity?: number | null;
  /** Not clearable via this form yet — ClassesService.update() converts these
   * via `dto.X ? new Date(dto.X) : undefined`, a falsy check that would treat
   * an explicit `null` the same as an omitted field. A real, separate,
   * flagged backend gap (see that service's own comment), not something this
   * form can fix on its own. */
  bookingEndAt?: string;
  qrAttendanceEndAt?: string;
  refundFeeDate?: string;
  cancellationCharge?: number | null;
  /** Always populated — the checkbox defaults to false, never undefined. */
  termsWaiverRequired: boolean;
  membershipInclusion: boolean;
}

/** Fields match CreateClassDto/UpdateClassDto exactly —
 * apps/api/src/classes/dto/create-class.dto.ts. `instructorId` is a dropdown
 * sourced from this School's own Instructor profiles (value = the profile's
 * `userId`, since instructorId means "a User holding an active INSTRUCTOR
 * RoleGrant", not the Instructor profile's own id — see that DTO's own
 * comment), labeled by the profile's resolved name (InstructorResponseDto's
 * firstName/surname, joined server-side via PrismaAuthService). `activities`
 * is comma-separated free text, same convention as School.activities and
 * Discipline.classTypesOffered — not a hard FK to Discipline (the DTO
 * validates it as free-form strings, not discipline ids). */
export function ClassFormModal({
  title,
  schoolId,
  initial,
  branches,
  instructors,
  disciplines,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  /** Required so the Banner field's upload URL request can be authorized
   * (School Owner at this School — see UploadsService's own comment), on
   * both create (no Class id yet) and edit. */
  schoolId: string;
  initial?: Partial<ClassResponse>;
  branches: BranchResponse[];
  instructors: InstructorResponse[];
  /** The School's styles. With any, the class picks styles and class types
   * instead of free-text activities (Decisions 143, 152, 170). */
  disciplines: DisciplineResponse[];
  submitting: boolean;
  onSubmit: (values: ClassFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState({
    branchId: initial?.branchId ?? '',
    instructorId: initial?.instructorId ?? '',
    title: initial?.title ?? '',
    activities: (initial?.activities ?? []).join(', '),
    bannerUrl: initial?.bannerUrl ?? '',
    description: initial?.description ?? '',
    startDate: isoToLocalInput(initial?.startDate),
    endDate: isoToLocalInput(initial?.endDate),
    capacity: initial?.capacity?.toString() ?? '',
    bookingEndAt: isoToLocalInput(initial?.bookingEndAt),
    qrAttendanceEndAt: isoToLocalInput(initial?.qrAttendanceEndAt),
    refundFeeDate: isoToLocalInput(initial?.refundFeeDate),
    cancellationCharge: initial?.cancellationCharge?.toString() ?? '',
    termsWaiverRequired: initial?.termsWaiverRequired ?? false,
    membershipInclusion: initial?.membershipInclusion ?? false,
  });
  const [styles, setStyles] = useState<StyleSelection[]>(
    initial?.styles?.length ? initial.styles.map((s) => ({ disciplineId: s.disciplineId, classType: s.classType ?? null })) : [{ disciplineId: '', classType: null }],
  );
  const usesStyles = disciplines.length > 0;
  const [error, setError] = useState<string | null>(null);
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const startDate = localInputToIso(form.startDate);
    const endDate = localInputToIso(form.endDate);
    if (!startDate || !endDate) {
      setError(t('classes.form.datesRequired'));
      return;
    }
    // FOUND ON REVIEW: `required` on the raw Activities input only guarantees
    // non-empty TEXT (e.g. "," alone passes) — validate the actual parsed
    // array, which is what CreateClassDto's own ArrayMinSize(1) enforces.
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
      setError(t('classes.form.activitiesRequired'));
      return;
    }
    // FOUND ON REVIEW: the backend does enforce this too (assertValidDateRange),
    // but only after a round trip — catch the common case here for immediate
    // feedback.
    if (new Date(endDate).getTime() <= new Date(startDate).getTime()) {
      setError(t('classes.form.endAfterStart'));
      return;
    }
    try {
      await onSubmit({
        branchId: form.branchId || null,
        instructorId: form.instructorId || null,
        title: form.title,
        ...(usesStyles ? { styles } : { activities }),
        bannerUrl: form.bannerUrl || null,
        description: form.description || null,
        startDate,
        endDate,
        capacity: form.capacity ? Number(form.capacity) : null,
        bookingEndAt: localInputToIso(form.bookingEndAt),
        qrAttendanceEndAt: localInputToIso(form.qrAttendanceEndAt),
        refundFeeDate: localInputToIso(form.refundFeeDate),
        cancellationCharge: form.cancellationCharge ? Number(form.cancellationCharge) : null,
        termsWaiverRequired: form.termsWaiverRequired,
        membershipInclusion: form.membershipInclusion,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('classes.form.titleLabel')} htmlFor="class-title">
          <TextField required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        {usesStyles ? (
          <StylePicker idPrefix="class" disciplines={disciplines} value={styles} onChange={setStyles} />
        ) : (
          <Field label={t('classes.form.activitiesLabel')} htmlFor="class-activities" hint={t('classes.form.activitiesHint')}>
            <TextField
              required
              value={form.activities}
              onChange={(e) => setForm((f) => ({ ...f, activities: e.target.value }))}
            />
          </Field>
        )}
        <Field label={t('classes.form.branchLabel')} htmlFor="class-branch" hint={t('classes.form.branchHint')}>
          <SelectField
            value={form.branchId}
            onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
            options={[{ value: '', label: t('classes.form.wholeSchool') }, ...branchSelectOptions(branches, t('branches.archivedBadge'), initial?.branchId)]}
          />
        </Field>
        <Field label={t('classes.form.instructorLabel')} htmlFor="class-instructor">
          <SelectField
            value={form.instructorId}
            onChange={(e) => setForm((f) => ({ ...f, instructorId: e.target.value }))}
            options={[
              { value: '', label: t('classes.form.unassigned') },
              ...instructorSelectOptions(instructors, { archived: t('instructors.pickerArchived'), revoked: t('instructors.pickerRevoked') }, initial?.instructorId),
            ]}
          />
        </Field>
        <Field label={t('classes.form.startDateLabel')} htmlFor="class-startDate">
          <TextField
            required
            type="datetime-local"
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
          />
        </Field>
        <Field label={t('classes.form.endDateLabel')} htmlFor="class-endDate">
          <TextField
            required
            type="datetime-local"
            value={form.endDate}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
          />
        </Field>
        <Field label={t('classes.form.capacityLabel')} htmlFor="class-capacity" hint={t('classes.form.capacityHint')}>
          <TextField
            type="number"
            min={1}
            value={form.capacity}
            onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
          />
        </Field>
        <Field
          label={t('classes.form.bookingCutoffLabel')}
          htmlFor="class-bookingEndAt"
          hint={initial?.bookingEndAt ? t('classes.form.cantClearHint') : undefined}
        >
          <TextField
            type="datetime-local"
            value={form.bookingEndAt}
            onChange={(e) => setForm((f) => ({ ...f, bookingEndAt: e.target.value }))}
          />
        </Field>
        <Field
          label={t('classes.form.qrWindowEndsLabel')}
          htmlFor="class-qrAttendanceEndAt"
          hint={initial?.qrAttendanceEndAt ? t('classes.form.cantClearHint') : undefined}
        >
          <TextField
            type="datetime-local"
            value={form.qrAttendanceEndAt}
            onChange={(e) => setForm((f) => ({ ...f, qrAttendanceEndAt: e.target.value }))}
          />
        </Field>
        <Field
          label={t('classes.form.refundCutoffLabel')}
          htmlFor="class-refundFeeDate"
          hint={initial?.refundFeeDate ? t('classes.form.cantClearHint') : undefined}
        >
          <TextField
            type="datetime-local"
            value={form.refundFeeDate}
            onChange={(e) => setForm((f) => ({ ...f, refundFeeDate: e.target.value }))}
          />
        </Field>
        <Field label={t('classes.form.cancellationChargeLabel')} htmlFor="class-cancellationCharge" hint={t('classes.form.cancellationChargeHint')}>
          <TextField
            type="number"
            min={0}
            value={form.cancellationCharge}
            onChange={(e) => setForm((f) => ({ ...f, cancellationCharge: e.target.value }))}
          />
        </Field>
        <Field label={t('classes.form.bannerLabel')} htmlFor="class-banner">
          <PhotoUploadField
            value={form.bannerUrl}
            onChange={(bannerUrl) => setForm((f) => ({ ...f, bannerUrl }))}
            requestUpload={(file) =>
              requestPhotoUpload.mutateAsync({
                entityType: 'CLASS',
                schoolId,
                entityId: initial?.id,
                contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
              })
            }
          />
        </Field>
        <Field label={t('classes.form.descriptionLabel')} htmlFor="class-description">
          <TextArea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <Checkbox
          label={t('classes.form.waiverRequired')}
          checked={form.termsWaiverRequired}
          onChange={(e) => setForm((f) => ({ ...f, termsWaiverRequired: e.target.checked }))}
        />
        <Checkbox
          label={t('classes.form.membershipInclusion')}
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
