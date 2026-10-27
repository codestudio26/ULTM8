import React, { useState } from 'react';
import { Button, ErrorBanner, Modal, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { formatLocale } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';
import { useDeleteLessonComment, useLessonComments, type LessonResponse } from './curriculumQueries';

/** Students' comments on one lesson, oldest first (Decision 326). Anyone with
 * the Curriculum page reads them; only the School owner removes one. */
export function LessonCommentsModal({ schoolId, lesson, canDelete, onClose }: { schoolId: string; lesson: LessonResponse; canDelete: boolean; onClose: () => void }) {
  const t = useT();
  const { data, isLoading, error } = useLessonComments(schoolId, lesson.id);
  const remove = useDeleteLessonComment(schoolId, lesson.id);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(commentId: string) {
    setDeleteError(null);
    try {
      await remove.mutateAsync(commentId);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t('curriculum.comments.deleteFailed'));
    }
  }

  return (
    <Modal title={t('curriculum.comments.title', { title: lesson.title })} onClose={onClose}>
      {error ? <ErrorBanner message={error instanceof ApiError ? error.message : t('curriculum.comments.loadFailed')} /> : null}
      {deleteError ? <ErrorBanner message={deleteError} /> : null}
      {isLoading ? <Spinner /> : null}
      {data && data.length === 0 ? <p className="ultm8-field__hint">{t('curriculum.comments.empty')}</p> : null}
      {data && data.length > 0 ? (
        <ul aria-label={t('curriculum.comments.listLabel')} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {data.map((c) => (
            <li key={c.id} style={{ borderBottom: '1px solid var(--ultm8-border, #ddd)', padding: '8px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div>
                  <strong>{c.authorName || t('curriculum.comments.unknownAuthor')}</strong>{' '}
                  <span className="ultm8-field__hint">{new Date(c.createdAt).toLocaleString(formatLocale())}</span>
                  <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{c.body}</p>
                </div>
                {canDelete ? (
                  <Button variant="secondary" onClick={() => handleDelete(c.id)} disabled={remove.isPending} aria-label={t('curriculum.comments.deleteAria', { name: c.authorName })}>
                    {t('curriculum.delete')}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {!canDelete ? <p className="ultm8-field__hint">{t('curriculum.comments.ownerOnly')}</p> : null}
    </Modal>
  );
}
