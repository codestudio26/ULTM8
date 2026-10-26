import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { instructorSelectOptions, type InstructorResponse } from '../instructors/instructorQueries';
import type { DisciplineSkillGroup } from './curriculumQueries';
import type { LessonCategory, LessonResponse } from './curriculumQueries';
import { useT } from '../i18n/I18nProvider';

/** Fields match CreateLessonDto/UpdateLessonDto exactly —
 * apps/api/src/curriculum/dto/create-lesson.dto.ts. `videoRef`/`captionStatus`/
 * `captionTrackRef` are deliberately NOT form fields — that DTO's own header
 * comment explains why: no video-hosting/captioning pipeline is built yet
 * (Decision 101 picked vendors, didn't build the integration), so a Lesson is
 * created with captionStatus defaulting to PENDING and videoRef/captionTrackRef
 * null. `instructorId`, like Class's own, must already hold an active
 * Instructor RoleGrant at this School (assertValidInstructor) — same
 * `userId`-is-really-a-RoleGrant-check reasoning InstructorFormModal's own
 * header comment gives for its `userId` field, except here the picker can
 * actually be a dropdown, since InstructorsPage already lists eligible
 * Instructor profiles. */
export function LessonFormModal({
  title,
  initial,
  instructors,
  skillGroups,
  categories,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<LessonResponse>;
  instructors: InstructorResponse[];
  skillGroups: DisciplineSkillGroup[];
  categories: LessonCategory[];
  submitting: boolean;
  onSubmit: (values: {
    title: string;
    /** null: no category. */
    categoryId: string | null;
    /** Watchable by every student and guardian at the School (Decision 190). */
    free: boolean;
    /** null: empty. The edit form sends null so a cleared field is cleared (C1). */
    durationSeconds: number | null;
    description: string | null;
    format: 'PRERECORDED' | 'LIVE';
    instructorId: string | null;
    skillIds: string[];
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    categoryId: initial?.categoryId ?? '',
    free: initial?.free ?? false,
    durationSeconds: initial?.durationSeconds?.toString() ?? '',
    description: initial?.description ?? '',
    format: initial?.format ?? 'PRERECORDED',
    instructorId: initial?.instructorId ?? '',
    skillIds: initial?.skillIds ?? [],
  });
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  function toggleSkill(skillId: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      skillIds: checked ? [...f.skillIds, skillId] : f.skillIds.filter((id) => id !== skillId),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) {
      setError(t('curriculum.form.titleRequired'));
      return;
    }
    if (form.skillIds.length === 0) {
      setError(t('curriculum.form.skillRequired'));
      return;
    }
    try {
      await onSubmit({
        title: form.title.trim(),
        categoryId: form.categoryId || null,
        free: form.free,
        durationSeconds: form.durationSeconds ? Number(form.durationSeconds) : null,
        description: form.description.trim() ? form.description : null,
        format: form.format as 'PRERECORDED' | 'LIVE',
        instructorId: form.instructorId || null,
        skillIds: form.skillIds,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('curriculum.form.titleLabel')} htmlFor="lesson-title">
          <TextField required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label={t('curriculum.form.categoryLabel')} htmlFor="lesson-category" hint={t('curriculum.form.categoryHint')}>
          <SelectField
            id="lesson-category"
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            options={[{ value: '', label: t('curriculum.noCategory') }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </Field>
        <Checkbox
          label={t('curriculum.form.free')}
          checked={form.free}
          onChange={(e) => setForm((f) => ({ ...f, free: e.target.checked }))}
        />
        <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
          {t('curriculum.form.freeHint')}
        </p>
        <Field label={t('curriculum.form.duration')} htmlFor="lesson-duration">
          <TextField
            type="number"
            min={1}
            value={form.durationSeconds}
            onChange={(e) => setForm((f) => ({ ...f, durationSeconds: e.target.value }))}
          />
        </Field>
        <Field label={t('curriculum.form.description')} htmlFor="lesson-description">
          <TextArea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <Field label={t('curriculum.form.format')} htmlFor="lesson-format">
          <SelectField
            value={form.format}
            onChange={(e) => setForm((f) => ({ ...f, format: e.target.value as 'PRERECORDED' | 'LIVE' }))}
            options={[
              { value: 'PRERECORDED', label: t('curriculum.formatPrerecorded') },
              { value: 'LIVE', label: t('curriculum.formatLive') },
            ]}
          />
        </Field>
        <Field label={t('curriculum.form.instructor')} htmlFor="lesson-instructor" hint={t('curriculum.form.instructorHint')}>
          <SelectField
            value={form.instructorId}
            onChange={(e) => setForm((f) => ({ ...f, instructorId: e.target.value }))}
            options={[
              { value: '', label: t('curriculum.form.none') },
              ...instructorSelectOptions(instructors, { archived: t('instructors.pickerArchived'), revoked: t('instructors.pickerRevoked') }, initial?.instructorId),
            ]}
          />
        </Field>

        <div className="ultm8-field" style={{ marginTop: 16 }}>
          <p className="ultm8-field__label" style={{ marginBottom: 8 }}>
            {t('curriculum.form.skillsTaught')}
          </p>
          <p className="ultm8-field__hint" style={{ marginBottom: 8 }}>
            {t('curriculum.form.skillsHint')}
          </p>
          {!skillGroups.some((g) => !g.archived && g.skills.length > 0) && !initial?.skillIds?.length ? (
            <p className="ultm8-field__hint">{t('curriculum.form.noSkills')}</p>
          ) : (
            skillGroups.map((group) => {
              // An archived style shows only the skills this lesson already
              // has from it, so they can be unticked but not newly picked (C10).
              const skills = group.archived ? group.skills.filter((s) => initial?.skillIds?.includes(s.id)) : group.skills;
              return skills.length === 0 ? null : (
                <div key={group.disciplineId} style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: 13 }}>
                    {group.disciplineName}
                    {group.archived ? <span className="ultm8-field__hint"> {t('curriculum.form.archivedStyle')}</span> : null}
                  </strong>
                  {skills.map((skill) => (
                    <Checkbox
                      key={skill.id}
                      label={skill.name}
                      checked={form.skillIds.includes(skill.id)}
                      onChange={(e) => toggleSkill(skill.id, e.target.checked)}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>

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
