import React, { useState } from 'react';
import { Button, Card, ErrorBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { TAG_NAME_MAX } from '../students/StudentTagsCard';
import { useCreateSchoolTag, useDeleteSchoolTag, useRenameSchoolTag, useSchoolTags, type SchoolTag } from '../students/studentTagsQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * Backlog 5.4 (Decision 315 item 7): the School's own list of student tags.
 * Add, rename and delete; deleting a tag takes it off every student. Staff
 * can also add a new tag while tagging a student. Members never see tags.
 */
export function StudentTagsSettingsCard({ schoolId }: { schoolId: string }) {
  const t = useT();
  const tags = useSchoolTags(schoolId);
  const create = useCreateSchoolTag(schoolId);
  const [name, setName] = useState('');
  if (tags.isError) return null;
  const items = tags.data?.items ?? [];

  return (
    <Card>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.studentTags.title')}</h2>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.studentTags.subtitle')}</p>
      {create.error ? <ErrorBanner message={errorText(create.error, t('students.tags.failed'))} /> : null}
      {items.length === 0 ? <p className="ultm8-field__hint">{t('schools.studentTags.empty')}</p> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((tag) => (
          <TagRow key={`${tag.id}-${tag.name}`} schoolId={schoolId} tag={tag} />
        ))}
      </ul>
      <form
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (clean(name)) create.mutate(clean(name), { onSuccess: () => setName('') });
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <TextField aria-label={t('schools.studentTags.newLabel')} placeholder={t('students.tags.placeholder')} maxLength={TAG_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary" disabled={!clean(name)} loading={create.isPending}>
          {t('schools.studentTags.add')}
        </Button>
      </form>
    </Card>
  );
}

function TagRow({ schoolId, tag }: { schoolId: string; tag: SchoolTag }) {
  const t = useT();
  const rename = useRenameSchoolTag(schoolId);
  const remove = useDeleteSchoolTag(schoolId);
  const [name, setName] = useState(tag.name);
  const [confirming, setConfirming] = useState(false);
  const error = rename.error ?? remove.error;
  const changed = clean(name) !== '' && clean(name) !== tag.name;

  return (
    <li>
      {error ? <ErrorBanner message={errorText(error, t('students.tags.failed'))} /> : null}
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) rename.mutate({ tagId: tag.id, name: clean(name) });
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <TextField aria-label={t('schools.studentTags.nameLabel', { tag: tag.name })} maxLength={TAG_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <span className="ultm8-field__hint">{t('schools.studentTags.count', { count: tag.studentCount })}</span>
        <Button type="submit" variant="secondary" disabled={!changed} loading={rename.isPending}>
          {t('schools.studentTags.rename')}
        </Button>
        {confirming ? (
          <>
            <span>{t('schools.studentTags.confirmDelete')}</span>
            <Button type="button" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(tag.id)}>
              {t('schools.studentTags.delete')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            {t('schools.studentTags.delete')}
          </Button>
        )}
      </form>
    </li>
  );
}
