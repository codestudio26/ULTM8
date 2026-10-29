import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from './disciplineQueries';
import { useT } from '../i18n/I18nProvider';

export interface DisciplineFormValues {
  name: string;
  classTypesOffered: string[];
  skillsRequiredToGrade: boolean;
  /** Class types renamed in this edit (Decision 309); always empty when adding. */
  renameClassTypes: Array<{ from: string; to: string }>;
  /** Backlog 3.20: the Adult style this Kids style links to; only sent when editing. */
  adultDisciplineId?: string | null;
}

/** One row of the class type list. `original` is the stored name the row
 * started as, so editing its text is a rename the API carries onto classes,
 * slots and rungs, not a remove-and-add. */
interface TypeRow {
  key: number;
  original: string | null;
  value: string;
}

let nextKey = 0;
const row = (original: string | null, value = original ?? ''): TypeRow => ({ key: nextKey++, original, value });

/** Fields match CreateDisciplineDto/UpdateDisciplineDto —
 * apps/api/src/ranks/dto/create-discipline.dto.ts and update-discipline.dto.ts.
 * Class types are a list, one per row, that can be renamed and reordered
 * (Decision 309). */
export function DisciplineFormModal({
  title,
  initial,
  adultChoices,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<DisciplineResponse>;
  /** Backlog 3.20: when editing, the styles this one can link to as its Adult
   * program. Null when it can't be a Kids style (it is another style's Adult
   * program); undefined hides the field (adding a style). */
  adultChoices?: DisciplineResponse[] | null;
  submitting: boolean;
  onSubmit: (values: DisciplineFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [skillsRequiredToGrade, setSkillsRequired] = useState(initial?.skillsRequiredToGrade ?? false);
  const [types, setTypes] = useState<TypeRow[]>(() => (initial?.classTypesOffered ?? []).map((c) => row(c)));
  const [adultId, setAdultId] = useState(initial?.adultDisciplineId ?? '');
  const [error, setError] = useState<string | null>(null);

  const update = (key: number, value: string) => setTypes((rows) => rows.map((r) => (r.key === key ? { ...r, value } : r)));
  const move = (i: number, delta: number) =>
    setTypes((rows) => {
      const j = i + delta;
      if (j < 0 || j >= rows.length) return rows;
      const next = [...rows];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  /** The problem with the form as it stands, or null (Decision 308: no blank
   * name, no class type twice). */
  function problem(): string | null {
    if (!name.trim()) return t('disciplines.form.nameRequired');
    const seen = new Set<string>();
    for (const r of types) {
      const v = r.value.trim();
      if (!v) continue;
      if (seen.has(v.toLowerCase())) return t('disciplines.form.classTypeTwice', { name: v });
      seen.add(v.toLowerCase());
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const issue = problem();
    if (issue) {
      setError(issue);
      return;
    }
    const kept = types.filter((r) => r.value.trim());
    try {
      await onSubmit({
        name: name.trim(),
        classTypesOffered: kept.map((r) => r.value.trim()),
        skillsRequiredToGrade,
        renameClassTypes: kept
          .filter((r) => r.original !== null && r.original !== r.value.trim())
          .map((r) => ({ from: r.original as string, to: r.value.trim() })),
        ...(adultChoices && adultId !== (initial?.adultDisciplineId ?? '') ? { adultDisciplineId: adultId || null } : {}),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('disciplines.form.nameLabel')} htmlFor="discipline-name">
          <TextField id="discipline-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
          <legend className="ultm8-field__label">{t('disciplines.form.classTypesLabel')}</legend>
          <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
            {t('disciplines.form.classTypesHint')}
          </p>
          {types.map((r, i) => (
            <div key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <TextField
                aria-label={t('disciplines.form.classTypeAria', { number: i + 1 })}
                maxLength={100}
                value={r.value}
                onChange={(e) => update(r.key, e.target.value)}
              />
              <Button type="button" variant="secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('disciplines.form.moveUpAria', { number: i + 1 })}>
                ↑
              </Button>
              <Button type="button" variant="secondary" onClick={() => move(i, 1)} disabled={i === types.length - 1} aria-label={t('disciplines.form.moveDownAria', { number: i + 1 })}>
                ↓
              </Button>
              <Button type="button" variant="secondary" onClick={() => setTypes((rows) => rows.filter((x) => x.key !== r.key))} aria-label={t('disciplines.form.removeAria', { number: i + 1 })}>
                {t('disciplines.form.remove')}
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setTypes((rows) => [...rows, row(null)])}>
            {t('disciplines.form.addClassType')}
          </Button>
        </fieldset>
        <Checkbox label={t('disciplines.form.skillsRequired')} checked={skillsRequiredToGrade} onChange={(e) => setSkillsRequired(e.target.checked)} />
        {adultChoices ? (
          <Field label={t('disciplines.form.adultProgramLabel')} htmlFor="discipline-adult" hint={t('disciplines.form.adultProgramHint')}>
            <SelectField
              id="discipline-adult"
              value={adultId}
              onChange={(e) => setAdultId(e.target.value)}
              options={[{ value: '', label: t('disciplines.form.adultProgramNone') }, ...adultChoices.map((d) => ({ value: d.id, label: d.name }))]}
            />
          </Field>
        ) : adultChoices === null ? (
          <p className="ultm8-field__hint">{t('disciplines.form.isAdultProgram')}</p>
        ) : null}
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
