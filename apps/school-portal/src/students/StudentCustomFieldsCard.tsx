import React, { useEffect, useState } from 'react';
import { Button, ErrorBanner, Field, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { NewLookSelect } from '../layout/NewLookSelect';
import { StudentCard } from './StudentPageLook';
import {
  CUSTOM_TEXT_VALUE_MAX,
  useCustomMemberStatuses,
  useSetStudentCustomFields,
  useSetStudentCustomStatus,
  useStudentCustomFields,
  type StudentCustomFields,
} from './customMemberFieldsQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
type Field = StudentCustomFields['fields'][number];

/**
 * Decision 315 item 14: the student's member status and their values for the
 * School's own member fields. Staff-only, shown to the staff who can edit the
 * student's details; for anyone else the API refuses and the card hides. It
 * also hides while the School has no fields and no statuses.
 */
export function StudentCustomFieldsCard({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const data = useStudentCustomFields(schoolId, studentId);
  const statuses = useCustomMemberStatuses(schoolId);
  const save = useSetStudentCustomFields(schoolId, studentId);
  const setStatus = useSetStudentCustomStatus(schoolId, studentId);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const fields = data.data?.fields ?? [];

  // Start again from the saved values whenever they change.
  useEffect(() => {
    setDraft(Object.fromEntries((data.data?.fields ?? []).map((f) => [f.id, f.value ?? ''])));
  }, [data.data]);

  const statusItems = statuses.data?.items ?? [];
  if (data.isError || !data.data || (fields.length === 0 && statusItems.length === 0)) return null;

  const changed = fields.filter((f) => (draft[f.id] ?? '') !== (f.value ?? ''));
  const error = save.error ?? setStatus.error;

  return (
    <StudentCard title={t('students.customFields.title')}>
      {error ? <ErrorBanner message={errorText(error, t('students.customFields.failed'))} /> : null}
      {statusItems.length > 0 ? (
        <div className="ultm8-field">
          <NewLookSelect
            id={`custom-status-${studentId}`}
            label={t('students.customFields.statusLabel')}
            value={data.data.statusId ?? ''}
            disabled={setStatus.isPending}
            onChange={(v) => setStatus.mutate(v || null)}
            options={[{ value: '', label: t('students.customFields.statusNone') }, ...statusItems.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </div>
      ) : null}
      {fields.length > 0 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (changed.length === 0) return;
            setSaved(false);
            save.mutate(
              changed.map((f) => ({ fieldId: f.id, value: (draft[f.id] ?? '').trim() || null })),
              { onSuccess: () => setSaved(true) },
            );
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0 16px' }}>
            {fields.map((f) => {
              const onChange = (value: string) => {
                setSaved(false);
                setDraft((d) => ({ ...d, [f.id]: value }));
              };
              const choices = choicesOf(f, t);
              return choices ? (
                <div key={f.id} className="ultm8-field">
                  <NewLookSelect id={`custom-field-${f.id}`} label={f.name} value={draft[f.id] ?? ''} onChange={onChange} options={choices} />
                </div>
              ) : (
                <Field key={f.id} label={f.name} htmlFor={`custom-field-${f.id}`}>
                  <ValueInput id={`custom-field-${f.id}`} field={f} value={draft[f.id] ?? ''} onChange={onChange} />
                </Field>
              );
            })}
          </div>
          <div className="u8sp-line">
            <Button type="submit" disabled={changed.length === 0} loading={save.isPending}>
              {t('students.customFields.save')}
            </Button>
            {saved && changed.length === 0 ? <span className="ultm8-field__hint">{t('students.customFields.saved')}</span> : null}
          </div>
        </form>
      ) : null}
    </StudentCard>
  );
}

/** A Dropdown or Yes/No field's choices, for our own drop-down; null for a typed value. */
function choicesOf(field: Field, t: ReturnType<typeof useT>): Array<{ value: string; label: string }> | null {
  if (field.type === 'DROPDOWN') return [{ value: '', label: t('students.customFields.notSet') }, ...field.options.map((o) => ({ value: o, label: o }))];
  if (field.type === 'YES_NO') {
    return [
      { value: '', label: t('students.customFields.notSet') },
      { value: 'true', label: t('students.customFields.yes') },
      { value: 'false', label: t('students.customFields.no') },
    ];
  }
  return null;
}

function ValueInput({ id, field, value, onChange }: { id: string; field: Field; value: string; onChange: (value: string) => void }) {
  switch (field.type) {
    case 'NUMBER':
      return <TextField id={id} type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'DATE':
      return <TextField id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <TextField id={id} maxLength={CUSTOM_TEXT_VALUE_MAX} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}
