import React from 'react';
import { Button, Field, SelectField } from '@ultm8/ui';
import type { DisciplineResponse } from './disciplineQueries';

export interface StyleSelection {
  disciplineId: string;
  classType: string | null;
}

/** Problems with a picked list of styles, as a message, or null when it is
 * fine. Mirrors the API's own check (apps/api/src/classes/class-styles.ts,
 * Decision 170) so the owner sees it before submitting. */
export function styleSelectionProblem(disciplines: DisciplineResponse[], styles: StyleSelection[]): string | null {
  if (styles.length === 0) return 'Choose at least one style.';
  const seen = new Set<string>();
  for (const s of styles) {
    const d = disciplines.find((x) => x.id === s.disciplineId);
    if (!d) return 'Choose a style on every row.';
    if (seen.has(d.id)) return `"${d.name}" is listed twice.`;
    seen.add(d.id);
    if (d.classTypesOffered.length > 0 && !s.classType) return `Choose a class type for "${d.name}".`;
  }
  return null;
}

/** Style + class type picker for classes and timetable slots (Decisions 143,
 * 152, 170): one row per style, each with a class type from that style's own
 * list when it has one. A mixed class (e.g. an Open Mat for BJJ and Judo)
 * has several rows. */
export function StylePicker({
  idPrefix,
  disciplines,
  value,
  onChange,
}: {
  idPrefix: string;
  disciplines: DisciplineResponse[];
  value: StyleSelection[];
  onChange: (next: StyleSelection[]) => void;
}) {
  const update = (i: number, patch: Partial<StyleSelection>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="ultm8-field">
      {value.map((row, i) => {
        const discipline = disciplines.find((d) => d.id === row.disciplineId);
        const types = discipline?.classTypesOffered ?? [];
        return (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={i === 0 ? 'Style' : `Style ${i + 1}`} htmlFor={`${idPrefix}-style-${i}`}>
              <SelectField
                required
                value={row.disciplineId}
                // A new style starts with no class type: the old one belonged to the previous style's list.
                onChange={(e) => update(i, { disciplineId: e.target.value, classType: null })}
                options={[{ value: '', label: 'Select a style…' }, ...disciplines.map((d) => ({ value: d.id, label: d.name }))]}
              />
            </Field>
            {types.length > 0 ? (
              <Field label="Class type" htmlFor={`${idPrefix}-type-${i}`}>
                <SelectField
                  required
                  value={row.classType ?? ''}
                  onChange={(e) => update(i, { classType: e.target.value || null })}
                  options={[{ value: '', label: 'Select a class type…' }, ...types.map((t) => ({ value: t, label: t }))]}
                />
              </Field>
            ) : null}
            {value.length > 1 ? (
              <Button type="button" variant="secondary" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                Remove
              </Button>
            ) : null}
          </div>
        );
      })}
      <Button type="button" variant="secondary" onClick={() => onChange([...value, { disciplineId: '', classType: null }])}>
        Add another style
      </Button>
    </div>
  );
}
