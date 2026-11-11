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
        <ul aria-label={t('curriculum.comments.listLabel')} className="u8c-comments">
          {data.map((c) => (
            <li key={c.id} className="u8c-comment">
              <div style={{ minWidth: 0 }}>
                <strong className="u8c-comment__who">{c.authorName || t('curriculum.comments.unknownAuthor')}</strong>{' '}
                <span className="u8c-comment__when">{new Date(c.createdAt).toLocaleString(formatLocale())}</span>
                <p className="u8c-comment__body">{c.body}</p>
              </div>
              {canDelete ? (
                <Button
                  variant="secondary"
                  className="u8c-btn-sm"
                  onClick={() => handleDelete(c.id)}
                  disabled={remove.isPending}
                  aria-label={t('curriculum.comments.deleteAria', { name: c.authorName })}
                >
                  {t('curriculum.delete')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!canDelete ? <p className="ultm8-field__hint">{t('curriculum.comments.ownerOnly')}</p> : null}
    </Modal>
  );
}
