import React, { useState } from 'react';
import { Button, ErrorBanner, Modal, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useRequestVideoUploadUrl, type LessonResponse } from './curriculumQueries';
import { useT } from '../i18n/I18nProvider';

/** First video-upload UI in the app (Decision 101's pipeline, now wired —
 * see `useRequestVideoUploadUrl`'s own header comment). Deliberately NOT
 * built on `PhotoUploadField` (`@ultm8/ui`) — that component assumes an
 * S3-presigned PUT with a `Content-Type` header and a synchronous "done"
 * state. Cloudflare Stream's "direct creator upload" URL takes a raw PUT
 * with no `Content-Type` dance, and there is no synchronous "done" at all:
 * `captionStatus` only ever reaches PROCESSING here — READY comes later,
 * asynchronously, once `VideoProcessingPollScheduler` finishes polling
 * Cloudflare Stream + AWS Transcribe, with no way for this modal to know
 * when. So this modal only ever reports "uploading" (the PUT itself) and
 * then hands back control — never "ready".
 *
 * DISCLOSED ROUGH EDGE (out of scope to fix here): `useRequestVideoUploadUrl`
 * has ALREADY written `videoRef` and flipped `captionStatus` to PROCESSING
 * on the Lesson by the time `uploadUrl` comes back — before the PUT below
 * even starts. If that PUT then fails (network blip, bad/expired Cloudflare
 * URL, no real R2/Stream credentials in this environment, etc.), the Lesson
 * is left stuck PROCESSING with no real video behind it, and this modal does
 * NOT attempt any retry or rollback of that half-written state — the error
 * below is shown, but the Lesson itself stays inconsistent until someone
 * notices (e.g. captionStatus never reaches READY/FAILED on its own, since
 * the poll scheduler has nothing real to poll). A real, known workflow gap;
 * not fixed here. */
export function VideoUploadModal({
  schoolId,
  lesson,
  onClose,
  onUploaded,
}: {
  schoolId: string;
  lesson: LessonResponse;
  onClose: () => void;
  /** Called once the raw file PUT to Cloudflare succeeds — NOT once the
   * video is actually ready to watch (see this component's own header
   * comment). The caller is expected to close this modal and show its own
   * brief "uploading, check back later" message, same as CurriculumPage
   * does. */
  onUploaded: () => void;
}) {
  const requestUploadUrl = useRequestVideoUploadUrl(schoolId);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  async function handleFileSelected(file: File) {
    setError(null);
    setUploading(true);
    try {
      const { uploadUrl } = await requestUploadUrl.mutateAsync(lesson.id);
      // Raw browser PUT straight to Cloudflare Stream — NOT through
      // apiClient/this app's own backend: no auth header, no JSON, just the
      // video bytes. A plain `fetch` is used rather than `XMLHttpRequest`
      // (which would be needed for real upload-progress events) since this
      // is the first upload UI of its kind here and a simple boolean
      // "uploading" state is enough for now.
      const putRes = await fetch(uploadUrl, { method: 'PUT', body: file });
      if (!putRes.ok) {
        throw new Error(t('curriculum.video.failed'));
      }
      onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('curriculum.video.failed'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal title={t('curriculum.video.title', { title: lesson.title })} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
        {t('curriculum.video.hint')}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="file"
          accept="video/*"
          disabled={uploading}
          aria-label={t('curriculum.video.fileAria', { title: lesson.title })}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // allows picking the exact same file again later
            if (file) void handleFileSelected(file);
          }}
        />
        {uploading ? <Spinner /> : null}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={uploading}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
