import React, { useState } from 'react';
import { Button, ErrorBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useAddStudentTag, useRemoveStudentTag, useSchoolTags, useStudentTags } from './studentTagsQueries';

/** Same limit as the API (backlog 5.4). */
export const TAG_NAME_MAX = 40;

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Tags on a student (backlog 5.4; Decision 315 item 7): tags plus "+ tag".
 * Staff pick a tag from the School's list or type a new one, which joins the
 * list. Members never see their tags. Shown to the staff who can edit the
 * student's details; for anyone else the API refuses and the card hides.
 * In the new look it is the last section of the student page's summary
 * panel (DESIGN-BRIEF §8: tags, with "+ tag").
 */
export function StudentTagsCard({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const tags = useStudentTags(schoolId, studentId);
  const schoolTags = useSchoolTags(schoolId);
  const add = useAddStudentTag(schoolId, studentId);
  const remove = useRemoveStudentTag(schoolId, studentId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  if (tags.isError) return null;

  const mine = tags.data?.items ?? [];
  const choices = (schoolTags.data?.items ?? []).filter((s) => !mine.some((m) => m.id === s.id));
  const listId = `student-tags-${studentId}`;
  const error = add.error ?? remove.error;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const typed = name.trim().replace(/\s+/g, ' ');
    if (!typed) return;
    const existing = (schoolTags.data?.items ?? []).find((s) => s.name.toLowerCase() === typed.toLowerCase());
    add.mutate(existing ? { tagId: existing.id } : { name: typed }, {
      onSuccess: () => {
        setName('');
        setAdding(false);
      },
    });
  }

  return (
    <section aria-label={t('students.tags.title')}>
      <h3 className="u8n-student-panel__heading">{t('students.tags.title')}</h3>
      {error ? <ErrorBanner message={errorText(error, t('students.tags.failed'))} /> : null}
      <ul aria-label={t('students.tags.title')} className="u8sp-tags">
        {mine.map((tag) => (
          <li key={tag.id} className="u8sp-tag">
            {tag.name}
            <button
              type="button"
              className="u8sp-tag__remove"
              aria-label={t('students.tags.remove', { tag: tag.name })}
              disabled={remove.isPending}
              onClick={() => remove.mutate(tag.id)}
            >
              ×
            </button>
          </li>
        ))}
        {!adding ? (
          <li>
            <Button variant="secondary" className="u8sp-tag-add" onClick={() => setAdding(true)}>
              {t('students.tags.add')}
            </Button>
          </li>
        ) : null}
      </ul>
      {mine.length === 0 && !adding ? <p className="u8sp-panel__note">{t('students.tags.empty')}</p> : null}
      {adding ? (
        <form onSubmit={submit} className="u8sp-panel__form">
          <TextField
            aria-label={t('students.tags.inputLabel')}
            placeholder={t('students.tags.placeholder')}
            list={listId}
            autoFocus
            maxLength={TAG_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <datalist id={listId}>
            {choices.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <div className="u8sp-panel__buttons u8sp-panel__buttons--pair">
            <Button type="submit" disabled={!name.trim()} loading={add.isPending}>
              {t('students.tags.save')}
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setAdding(false);
                setName('');
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
