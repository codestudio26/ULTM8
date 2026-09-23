import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { InstructorResponse } from '../instructors/instructorQueries';
import type { DisciplineSkillGroup } from './curriculumQueries';
import type { LessonResponse } from './curriculumQueries';

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
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<LessonResponse>;
  instructors: InstructorResponse[];
  skillGroups: DisciplineSkillGroup[];
  submitting: boolean;
  onSubmit: (values: {
    title: string;
    category?: string;
    durationSeconds?: number;
    description?: string;
    format: 'PRERECORDED' | 'LIVE';
    instructorId?: string;
    skillIds: string[];
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    category: initial?.category ?? '',
    durationSeconds: initial?.durationSeconds?.toString() ?? '',
    description: initial?.description ?? '',
    format: initial?.format ?? 'PRERECORDED',
    instructorId: initial?.instructorId ?? '',
    skillIds: initial?.skillIds ?? [],
  });
  const [error, setError] = useState<string | null>(null);

  function toggleSkill(skillId: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      skillIds: checked ? [...f.skillIds, skillId] : f.skillIds.filter((id) => id !== skillId),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.skillIds.length === 0) {
      setError('Select at least one Skill this Lesson teaches.');
      return;
    }
    try {
      await onSubmit({
        title: form.title,
        category: form.category || undefined,
        durationSeconds: form.durationSeconds ? Number(form.durationSeconds) : undefined,
        description: form.description || undefined,
        format: form.format as 'PRERECORDED' | 'LIVE',
        instructorId: form.instructorId || undefined,
        skillIds: form.skillIds,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Title" htmlFor="lesson-title">
          <TextField required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field
          label="Category"
          htmlFor="lesson-category"
          hint="Plain text only — not a real catalog entity (see this Lesson's own field list)."
        >
          <TextField value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
        </Field>
        <Field label="Duration (seconds)" htmlFor="lesson-duration">
          <TextField
            type="number"
            min={1}
            value={form.durationSeconds}
            onChange={(e) => setForm((f) => ({ ...f, durationSeconds: e.target.value }))}
          />
        </Field>
        <Field label="Description" htmlFor="lesson-description">
          <TextArea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <Field label="Format" htmlFor="lesson-format">
          <SelectField
            value={form.format}
            onChange={(e) => setForm((f) => ({ ...f, format: e.target.value as 'PRERECORDED' | 'LIVE' }))}
            options={[
              { value: 'PRERECORDED', label: 'Prerecorded' },
              { value: 'LIVE', label: 'Live' },
            ]}
          />
        </Field>
        <Field label="Instructor" htmlFor="lesson-instructor" hint="Optional — leave unselected if no single Instructor owns this Lesson.">
          <SelectField
            value={form.instructorId}
            onChange={(e) => setForm((f) => ({ ...f, instructorId: e.target.value }))}
            options={[
              { value: '', label: 'None' },
              ...instructors.map((i) => ({ value: i.userId, label: i.beltRanking ? `${i.userId} (${i.beltRanking})` : i.userId })),
            ]}
          />
        </Field>

        <div className="ultm8-field" style={{ marginTop: 16 }}>
          <p className="ultm8-field__label" style={{ marginBottom: 8 }}>
            Skills taught
          </p>
          <p className="ultm8-field__hint" style={{ marginBottom: 8 }}>
            At least one required — every Skill must belong to this School, from any Discipline.
          </p>
          {skillGroups.length === 0 ? (
            <p className="ultm8-field__hint">No Skills exist at this School yet — add one on the Disciplines page first.</p>
          ) : (
            skillGroups.map((group) =>
              group.skills.length === 0 ? null : (
                <div key={group.disciplineId} style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: 13 }}>{group.disciplineName}</strong>
                  {group.skills.map((skill) => (
                    <Checkbox
                      key={skill.id}
                      label={skill.name}
                      checked={form.skillIds.includes(skill.id)}
                      onChange={(e) => toggleSkill(skill.id, e.target.checked)}
                    />
                  ))}
                </div>
              ),
            )
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
