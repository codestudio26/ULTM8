import React, { useEffect, useState } from 'react';
import { Button, Card, ErrorBanner, Field, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
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
    <div style={{ marginBottom: 24 }}>
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 8 }}>
          {t('students.customFields.title')}
        </h2>
        {error ? <ErrorBanner message={errorText(error, t('students.customFields.failed'))} /> : null}
        {statusItems.length > 0 ? (
          <div style={{ maxWidth: 320 }}>
            <Field label={t('students.customFields.statusLabel')} htmlFor={`custom-status-${studentId}`}>
              <SelectField
                id={`custom-status-${studentId}`}
                value={data.data.statusId ?? ''}
                disabled={setStatus.isPending}
                onChange={(e) => setStatus.mutate(e.target.value || null)}
                options={[{ value: '', label: t('students.customFields.statusNone') }, ...statusItems.map((s) => ({ value: s.id, label: s.name }))]}
              />
            </Field>
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
              {fields.map((f) => (
                <Field key={f.id} label={f.name} htmlFor={`custom-field-${f.id}`}>
                  <ValueInput
                    id={`custom-field-${f.id}`}
                    field={f}
                    value={draft[f.id] ?? ''}
                    onChange={(value) => {
                      setSaved(false);
                      setDraft((d) => ({ ...d, [f.id]: value }));
                    }}
                  />
                </Field>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button type="submit" disabled={changed.length === 0} loading={save.isPending}>
                {t('students.customFields.save')}
              </Button>
              {saved && changed.length === 0 ? <span className="ultm8-field__hint">{t('students.customFields.saved')}</span> : null}
            </div>
          </form>
        ) : null}
      </Card>
    </div>
  );
}

function ValueInput({ id, field, value, onChange }: { id: string; field: Field; value: string; onChange: (value: string) => void }) {
  const t = useT();
  switch (field.type) {
    case 'NUMBER':
      return <TextField id={id} type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'DATE':
      return <TextField id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'DROPDOWN':
      return (
        <SelectField
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[{ value: '', label: t('students.customFields.notSet') }, ...field.options.map((o) => ({ value: o, label: o }))]}
        />
      );
    case 'YES_NO':
      return (
        <SelectField
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: '', label: t('students.customFields.notSet') },
            { value: 'true', label: t('students.customFields.yes') },
            { value: 'false', label: t('students.customFields.no') },
          ]}
        />
      );
    default:
      return <TextField id={id} maxLength={CUSTOM_TEXT_VALUE_MAX} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}
