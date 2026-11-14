import React from 'react';
import { Field, SearchableSelectField } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';
import { matchesSearch } from './studentSearch';
import type { StudentSummary } from './studentQueries';

/**
 * Pick a Student by typing part of their name (Decision 462 item 8): the
 * shared searchable picker, the same one Country and Currency use, matching
 * the way the Students list's search does. Used by the Class page's "Add a
 * student" and the Timetable's "Book a student". The value is the Student's
 * id, `''` for none.
 */
export function StudentPickerField({
  id,
  label,
  emptyLabel,
  hint,
  students,
  value,
  onChange,
}: {
  id: string;
  label: string;
  /** The first option and the empty field's placeholder, e.g. "Select a student…". */
  emptyLabel: string;
  hint?: string;
  students: StudentSummary[];
  value: string;
  onChange: (studentId: string) => void;
}) {
  const t = useT();
  // "Select a student…" first, as the drop-down it replaces had.
  const options: Pick<StudentSummary, 'id' | 'firstName' | 'surname' | 'email'>[] = [{ id: '', firstName: emptyLabel, surname: '', email: '' }, ...students];
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <SearchableSelectField
        id={id}
        fallbackId={id}
        options={options}
        getValue={(s) => s.id}
        getLabel={(s) => (s.id ? `${s.firstName} ${s.surname}`.trim() : emptyLabel)}
        // "Select a student…" is never a match for a search.
        matches={(s, q) => !!s.id && matchesSearch(s, q)}
        noMatchesText={t('ui.noMatches')}
        announcePick
        placeholder={emptyLabel}
        value={value}
        onChange={onChange}
      />
    </Field>
  );
}
