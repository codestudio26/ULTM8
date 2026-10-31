import React, { useState } from 'react';
import { Button, Card, ErrorBanner, TextField } from '@ultm8/ui';
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
    <div style={{ marginBottom: 24 }}>
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 8 }}>
          {t('students.tags.title')}
        </h2>
        {error ? <ErrorBanner message={errorText(error, t('students.tags.failed'))} /> : null}
        <ul aria-label={t('students.tags.title')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {mine.map((tag) => (
            <li key={tag.id} className="ultm8-badge" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              {tag.name}
              <button
                type="button"
                aria-label={t('students.tags.remove', { tag: tag.name })}
                disabled={remove.isPending}
                onClick={() => remove.mutate(tag.id)}
                style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit' }}
              >
                ×
              </button>
            </li>
          ))}
          {!adding ? (
            <li>
              <Button variant="secondary" onClick={() => setAdding(true)}>
                {t('students.tags.add')}
              </Button>
            </li>
          ) : null}
        </ul>
        {mine.length === 0 && !adding ? <p className="ultm8-field__hint" style={{ margin: '8px 0 0' }}>{t('students.tags.empty')}</p> : null}
        {adding ? (
          <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
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
            </div>
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
          </form>
        ) : null}
      </Card>
    </div>
  );
}
