import React from 'react';
import { Button, Field, SelectField } from '@ultm8/ui';
import type { DisciplineResponse } from './disciplineQueries';
import { useT, type TranslateFn } from '../i18n/I18nProvider';
import { disciplines as englishDisciplines } from '../i18n/messages/en/disciplines';

export interface StyleSelection {
  disciplineId: string;
  classType: string | null;
}

/** English wording for a caller that doesn't pass its own `t` yet. */
const englishOnly: TranslateFn = (key, vars) => {
  const leaf = key.split('.').pop() as keyof typeof englishDisciplines.stylePicker;
  return englishDisciplines.stylePicker[leaf].replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match));
};

/** Problems with a picked list of styles, as a message, or null when it is
 * fine. Mirrors the API's own check (apps/api/src/classes/class-styles.ts,
 * Decision 170) so the owner sees it before submitting. Pass the caller's
 * `t` (useT()) so the message is in the user's language. */
export function styleSelectionProblem(
  disciplines: DisciplineResponse[],
  styles: StyleSelection[],
  t: TranslateFn = englishOnly,
): string | null {
  if (styles.length === 0) return t('disciplines.stylePicker.noneChosen');
  const seen = new Set<string>();
  for (const s of styles) {
    const d = disciplines.find((x) => x.id === s.disciplineId);
    if (!d) return t('disciplines.stylePicker.emptyRow');
    if (seen.has(d.id)) return t('disciplines.stylePicker.listedTwice', { name: d.name });
    seen.add(d.id);
    if (d.classTypesOffered.length > 0 && !s.classType) return t('disciplines.stylePicker.classTypeMissing', { name: d.name });
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
  const t = useT();
  const update = (i: number, patch: Partial<StyleSelection>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="ultm8-field">
      {value.map((row, i) => {
        const discipline = disciplines.find((d) => d.id === row.disciplineId);
        const types = discipline?.classTypesOffered ?? [];
        return (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={i === 0 ? t('disciplines.stylePicker.style') : t('disciplines.stylePicker.styleNumbered', { number: i + 1 })} htmlFor={`${idPrefix}-style-${i}`}>
              <SelectField
                required
                value={row.disciplineId}
                // A new style starts with no class type: the old one belonged to the previous style's list.
                onChange={(e) => update(i, { disciplineId: e.target.value, classType: null })}
                // An archived style is offered only on the row that already has it, so an
                // older class or slot still saves (Decision 310); new rows can't pick it.
                options={[
                  { value: '', label: t('disciplines.stylePicker.selectStyle') },
                  ...disciplines
                    .filter((d) => !d.archivedAt || d.id === row.disciplineId)
                    .map((d) => ({ value: d.id, label: d.archivedAt ? t('disciplines.stylePicker.archivedName', { name: d.name }) : d.name })),
                ]}
              />
            </Field>
            {types.length > 0 ? (
              <Field label={t('disciplines.stylePicker.classType')} htmlFor={`${idPrefix}-type-${i}`}>
                <SelectField
                  required
                  value={row.classType ?? ''}
                  onChange={(e) => update(i, { classType: e.target.value || null })}
                  options={[{ value: '', label: t('disciplines.stylePicker.selectClassType') }, ...types.map((type) => ({ value: type, label: type }))]}
                />
              </Field>
            ) : null}
            {value.length > 1 ? (
              <Button type="button" variant="secondary" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                {t('disciplines.stylePicker.remove')}
              </Button>
            ) : null}
          </div>
        );
      })}
      <Button type="button" variant="secondary" onClick={() => onChange([...value, { disciplineId: '', classType: null }])}>
        {t('disciplines.stylePicker.addAnother')}
      </Button>
    </div>
  );
}
