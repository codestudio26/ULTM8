import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCreateFromTemplate, useDuplicateDiscipline, useStyleTemplates, type DisciplineResponse, type StyleTemplateId } from './disciplineQueries';

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong — please try again.');

/** "Start from template" (Decisions 131, 182): one of the three IBJJF ladders
 * with the prototype's numbers, which the school then edits as its own. */
export function TemplateModal({ schoolId, onCreated, onClose }: { schoolId: string; onCreated: (id: string) => void; onClose: () => void }) {
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
      setError(errorText(err));
    }
  }

  return (
    <Modal title="Start from a template" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        {loadError ? <ErrorBanner message={errorText(loadError)} /> : null}
        <p style={{ marginTop: 0 }}>
          Creates a new style with the template's belts, stripes, classes, minimum days and class types. You can change any of it afterwards.
        </p>
        {isLoading ? (
          <Spinner />
        ) : (
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
            <legend className="ultm8-field__label" style={{ marginBottom: 8 }}>
              Template
            </legend>
            {templates.map((t) => (
              <label key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="template"
                  value={t.id}
                  checked={templateId === t.id}
                  onChange={() => setTemplateId(t.id as StyleTemplateId)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>{t.name}</strong>
                  <br />
                  <span style={{ color: 'var(--text-secondary)' }}>{t.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <Field label="Style name" htmlFor="template-style-name" hint="Leave blank to use the template's name.">
          <TextField value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={create.isPending} disabled={!templateId}>
            Create style
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
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
  const duplicate = useDuplicateDiscipline(schoolId);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    try {
      const copy = await duplicate.mutateAsync(discipline.id);
      onCreated(copy.id);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Modal title={`Duplicate ${discipline.name}`} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ marginTop: 0 }}>
        Creates "{discipline.name} (Copy)" with the same belts, stripes and their rules, skills, class types, "skills required" setting and board
        columns. No students, ranks or coach permissions are copied.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button onClick={confirm} loading={duplicate.isPending}>
          Duplicate
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
