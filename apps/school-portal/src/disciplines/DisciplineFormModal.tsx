import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from './disciplineQueries';

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
  onSubmit: (values: { name: string; classTypesOffered?: string[] }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    classTypesOffered: (initial?.classTypesOffered ?? []).join(', '),
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
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Discipline name" htmlFor="discipline-name">
          <TextField required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field
          label="Class types offered"
          htmlFor="discipline-classTypes"
          hint='Comma-separated, e.g. "Kids Fundamentals, Adult Sparring, Competition Team"'
        >
          <TextField
            value={form.classTypesOffered}
            onChange={(e) => setForm((f) => ({ ...f, classTypesOffered: e.target.value }))}
          />
        </Field>
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
