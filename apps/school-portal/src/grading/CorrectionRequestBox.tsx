import React, { useState } from 'react';
import { Button, ErrorBanner, Field, TextArea } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useAnswerCorrection, type RankCorrection } from './gradingQueries';

const rungName = (r: RankCorrection['from']) => r.stripeName ?? r.rankName;

/**
 * Backlog 3.13 (Decisions 286, 299): a student asked for their belt in this
 * style to be corrected. The owner, or a coach with "Verify ranks", approves
 * it (the student moves to the belt they asked for, and the history notes
 * the correction and who made it) or rejects it (nothing changes). An
 * optional note goes back to the student either way.
 */
export function CorrectionRequestBox({ request, studentId, firstName }: { request: RankCorrection; studentId: string; firstName: string }) {
  const t = useT();
  const answer = useAnswerCorrection(studentId);
  const [note, setNote] = useState('');
  const asked = new Date(request.createdAt).toLocaleDateString();
  const send = (a: 'approve' | 'reject') => answer.mutate({ id: request.id, answer: a, note });

  return (
    <div role="region" aria-label={t('grading.correction.title')} style={{ marginTop: 12, padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
      <strong>{t('grading.correction.title')}</strong>
      <p style={{ margin: '4px 0' }}>
        {t('grading.correction.asked', { name: firstName, from: rungName(request.from), to: rungName(request.requested), date: asked })}
      </p>
      <p style={{ margin: '4px 0' }}>
        <em>{t('grading.correction.theirNote', { note: request.note })}</em>
      </p>
      <Field label={t('grading.correction.replyLabel')} htmlFor={`correction-note-${request.id}`} hint={t('grading.correction.replyHint')}>
        <TextArea id={`correction-note-${request.id}`} maxLength={500} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {answer.error ? <ErrorBanner message={answer.error instanceof ApiError ? answer.error.message : t('grading.correction.failed')} /> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button type="button" loading={answer.isPending} onClick={() => send('approve')}>
          {t('grading.correction.approve', { rank: rungName(request.requested) })}
        </Button>
        <Button type="button" variant="secondary" disabled={answer.isPending} onClick={() => send('reject')}>
          {t('grading.correction.reject')}
        </Button>
      </div>
    </div>
  );
}
