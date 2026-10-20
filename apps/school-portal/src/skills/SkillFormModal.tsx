import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { SkillResponse } from './skillQueries';
import { useT } from '../i18n/I18nProvider';

/** Fields match CreateSkillDto/UpdateSkillDto exactly —
 * apps/api/src/ranks/dto/create-skill.dto.ts. `description` is nullable on
 * update (see UpdateSkillDto's own header comment — same null-means-"clear"
 * convention established for every other optional field in this codebase). */
export function SkillFormModal({
  title,
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<SkillResponse>;
  submitting: boolean;
  onSubmit: (values: { name: string; description?: string | null }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({ name: form.name, description: form.description || null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('skills.form.nameLabel')} htmlFor="skill-name">
          <TextField required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label={t('skills.form.descriptionLabel')} htmlFor="skill-description">
          <TextArea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
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
