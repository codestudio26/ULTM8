import React, { useEffect, useState } from 'react';
import { Field, SelectField, TextField } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';
import type { CustomMemberField } from './customMemberFieldsQueries';

export interface MemberFieldFilterValue {
  fieldId: string;
  value: string;
}

/**
 * The Students list's Member field filter (Decision 315 item 14): pick one of
 * the School's fields, then a value. A drop-down offers its choices and yes/no
 * offers Yes or No; a number or date matches exactly; text matches students
 * whose value contains it. Typing is sent after a short pause.
 */
export function MemberFieldFilter({ fields, filter, onChange }: { fields: CustomMemberField[]; filter: MemberFieldFilterValue; onChange: (next: MemberFieldFilterValue) => void }) {
  const t = useT();
  const field = fields.find((f) => f.id === filter.fieldId);
  const [typed, setTyped] = useState(filter.value);
  useEffect(() => setTyped(filter.value), [filter.fieldId, filter.value]);
  useEffect(() => {
    if (typed === filter.value) return undefined;
    const timer = setTimeout(() => onChange({ fieldId: filter.fieldId, value: typed }), 300);
    return () => clearTimeout(timer);
  }, [typed, filter.fieldId, filter.value, onChange]);

  return (
    <>
      <div style={{ maxWidth: 220 }}>
        <Field label={t('students.customFields.fieldFilterLabel')} htmlFor="students-member-field-filter">
          <SelectField
            id="students-member-field-filter"
            value={filter.fieldId}
            onChange={(e) => onChange({ fieldId: e.target.value, value: '' })}
            options={[{ value: '', label: t('students.customFields.fieldFilterAll') }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
          />
        </Field>
      </div>
      {field ? (
        <div style={{ maxWidth: 220 }}>
          <Field label={field.type === 'TEXT' ? t('students.customFields.fieldFilterContains') : t('students.customFields.fieldFilterValue')} htmlFor="students-member-field-value">
            {field.type === 'DROPDOWN' || field.type === 'YES_NO' ? (
              <SelectField
                id="students-member-field-value"
                value={filter.value}
                onChange={(e) => onChange({ fieldId: field.id, value: e.target.value })}
                options={[
                  { value: '', label: t('students.customFields.fieldFilterAny') },
                  ...(field.type === 'DROPDOWN'
                    ? field.options.map((o) => ({ value: o, label: o }))
                    : [
                        { value: 'true', label: t('students.customFields.yes') },
                        { value: 'false', label: t('students.customFields.no') },
                      ]),
                ]}
              />
            ) : (
              <TextField
                id="students-member-field-value"
                type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'}
                step={field.type === 'NUMBER' ? 'any' : undefined}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            )}
          </Field>
        </div>
      ) : null}
    </>
  );
}
