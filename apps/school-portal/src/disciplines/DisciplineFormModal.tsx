import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from './disciplineQueries';
import { useT } from '../i18n/I18nProvider';

/** Fields match CreateDisciplineDto/UpdateDisciplineDto exactly —
 * apps/api/src/ranks/dto/create-discipline.dto.ts. `classTypesOffered` is a
 * comma-separated free-text list here, same convention SchoolPage.tsx
 * already established for School.activities/facilities. */
export function DisciplineFormModal({
  title,
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<DisciplineResponse>;
  submitting: boolean;
  onSubmit: (values: { name: string; classTypesOffered?: string[]; skillsRequiredToGrade?: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    classTypesOffered: (initial?.classTypesOffered ?? []).join(', '),
    skillsRequiredToGrade: initial?.skillsRequiredToGrade ?? false,
  });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({
        name: form.name,
        classTypesOffered: form.classTypesOffered
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        skillsRequiredToGrade: form.skillsRequiredToGrade,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('disciplines.form.nameLabel')} htmlFor="discipline-name">
          <TextField required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field
          label={t('disciplines.form.classTypesLabel')}
          htmlFor="discipline-classTypes"
          hint={t('disciplines.form.classTypesHint')}
        >
          <TextField
            value={form.classTypesOffered}
            onChange={(e) => setForm((f) => ({ ...f, classTypesOffered: e.target.value }))}
          />
        </Field>
        <Checkbox
          label={t('disciplines.form.skillsRequired')}
          checked={form.skillsRequiredToGrade}
          onChange={(e) => setForm((f) => ({ ...f, skillsRequiredToGrade: e.target.checked }))}
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
