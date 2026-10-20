import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCreateFromTemplate, useDuplicateDiscipline, useStyleTemplates, type DisciplineResponse, type StyleTemplateId } from './disciplineQueries';
import { useT, type TranslateFn } from '../i18n/I18nProvider';

const errorText = (err: unknown, t: TranslateFn) => (err instanceof ApiError ? err.message : t('common.tryAgain'));

/** "Start from template" (Decisions 131, 182): one of the three IBJJF ladders
 * with the prototype's numbers, which the school then edits as its own. */
export function TemplateModal({ schoolId, onCreated, onClose }: { schoolId: string; onCreated: (id: string) => void; onClose: () => void }) {
  const t = useT();
  const { data, isLoading, error: loadError } = useStyleTemplates();
  const create = useCreateFromTemplate(schoolId);
  const [templateId, setTemplateId] = useState<StyleTemplateId | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const templates = data?.items ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) return;
    setError(null);
    try {
      const style = await create.mutateAsync({ templateId, ...(name.trim() ? { name: name.trim() } : {}) });
      onCreated(style.id);
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <Modal title={t('disciplines.template.title')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        {loadError ? <ErrorBanner message={errorText(loadError, t)} /> : null}
        <p style={{ marginTop: 0 }}>
          {t('disciplines.template.intro')}
        </p>
        {isLoading ? (
          <Spinner />
        ) : (
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
            <legend className="ultm8-field__label" style={{ marginBottom: 8 }}>
              {t('disciplines.template.templateLegend')}
            </legend>
            {templates.map((tpl) => (
              <label key={tpl.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="template"
                  value={tpl.id}
                  checked={templateId === tpl.id}
                  onChange={() => setTemplateId(tpl.id as StyleTemplateId)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>{tpl.name}</strong>
                  <br />
                  <span style={{ color: 'var(--text-secondary)' }}>{tpl.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <Field label={t('disciplines.template.nameLabel')} htmlFor="template-style-name" hint={t('disciplines.template.nameHint')}>
          <TextField value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={create.isPending} disabled={!templateId}>
            {t('disciplines.template.create')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** "Duplicate" (Decision 182): the ladder, skills and settings, no students. */
export function DuplicateModal({
  schoolId,
  discipline,
  onCreated,
  onClose,
}: {
  schoolId: string;
  discipline: DisciplineResponse;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const duplicate = useDuplicateDiscipline(schoolId);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    try {
      const copy = await duplicate.mutateAsync(discipline.id);
      onCreated(copy.id);
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <Modal title={t('disciplines.duplicate.title', { name: discipline.name })} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ marginTop: 0 }}>
        {t('disciplines.duplicate.description', { name: discipline.name })}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button onClick={confirm} loading={duplicate.isPending}>
          {t('disciplines.duplicate.confirm')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
