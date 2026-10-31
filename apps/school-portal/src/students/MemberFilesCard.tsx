import React, { useRef, useState } from 'react';
import { Button, Card, ErrorBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import {
  MEMBER_FILE_ACCEPT,
  MEMBER_FILE_MAX_BYTES,
  hasMemberFileExtension,
  useDeleteMemberFile,
  useMemberFileDownload,
  useMemberFiles,
  useUploadMemberFile,
  type MemberFile,
} from './memberFilesQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Profile → Documents (backlog 5.11; Decision 315 item 9): files on a member,
 * PDF, JPG or PNG up to 10 MB each. Shown to the School's owners and to Branch
 * Staff the owner lets see member files; never to the member. `canUpload` is
 * off for a former student (the API only takes files for a current one).
 */
export function MemberFilesCard({ schoolId, studentId, canUpload }: { schoolId: string; studentId: string; canUpload: boolean }) {
  const t = useT();
  const files = useMemberFiles(schoolId, studentId);
  const upload = useUploadMemberFile(schoolId, studentId);
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  if (files.isError) return null;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setLocalError(null);
    upload.reset();
    if (!file) return;
    if (!hasMemberFileExtension(file.name)) return setLocalError(t('students.files.wrongType'));
    if (file.size > MEMBER_FILE_MAX_BYTES) return setLocalError(t('students.files.tooBig'));
    upload.mutate(file);
  }

  const uploadError =
    localError ??
    (upload.error
      ? upload.error instanceof ApiError && upload.error.status === 413
        ? t('students.files.tooBig')
        : errorText(upload.error, t('students.files.failed'))
      : null);
  const items = files.data?.items ?? [];

  return (
    <div style={{ marginBottom: 24 }} data-testid="member-files">
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 4 }}>
          {t('students.files.title')}
        </h2>
        <p className="ultm8-field__hint" style={{ margin: '0 0 12px' }}>
          {t('students.files.intro')}
        </p>
        {uploadError ? <ErrorBanner message={uploadError} /> : null}
        {canUpload ? (
          <div style={{ marginBottom: 16 }}>
            <input
              ref={input}
              type="file"
              accept={MEMBER_FILE_ACCEPT}
              onChange={onPick}
              style={{ display: 'none' }}
              aria-label={t('students.files.chooseLabel')}
              data-testid="member-file-input"
            />
            <Button onClick={() => input.current?.click()} loading={upload.isPending}>
              {t('students.files.upload')}
            </Button>
          </div>
        ) : null}
        {files.isLoading ? null : items.length === 0 ? (
          <p className="ultm8-field__hint">{t('students.files.empty')}</p>
        ) : (
          <div className="ultm8-table-scroll">
          <table className="ultm8-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th scope="col">{t('students.files.name')}</th>
                <th scope="col">{t('students.files.size')}</th>
                <th scope="col">{t('students.files.date')}</th>
                <th scope="col">{t('students.files.uploadedBy')}</th>
                <th scope="col" aria-label={t('students.files.actions')} />
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <FileRow key={f.id} file={f} schoolId={schoolId} studentId={studentId} />
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function FileRow({ file, schoolId, studentId }: { file: MemberFile; schoolId: string; studentId: string }) {
  const t = useT();
  const download = useMemberFileDownload(schoolId, studentId);
  const remove = useDeleteMemberFile(schoolId, studentId);
  const [confirming, setConfirming] = useState(false);
  const date = new Date(file.createdAt).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  const error = download.error
    ? errorText(download.error, t('students.files.downloadFailed'))
    : remove.error
      ? errorText(remove.error, t('students.files.deleteFailed'))
      : null;

  function onDownload() {
    download.mutate(file.id, {
      onSuccess: ({ url }) => {
        // A signed link that answers with the file as an attachment.
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      },
    });
  }

  return (
    <tr aria-label={t('students.files.itemLabel', { name: file.fileName, date })}>
      <td style={{ wordBreak: 'break-word' }}>
        {file.fileName}
        {error ? <ErrorBanner message={error} /> : null}
      </td>
      <td>{formatSize(file.sizeBytes, t)}</td>
      <td>{date}</td>
      <td>{file.uploadedByName ?? t('students.files.formerStaff')}</td>
      <td>
        {confirming ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span>{t('students.files.confirmDelete', { name: file.fileName })}</span>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(file.id)}>
              {t('students.files.delete')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" loading={download.isPending} onClick={onDownload}>
              {t('students.files.download')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              {t('students.files.delete')}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function formatSize(bytes: number, t: ReturnType<typeof useT>): string {
  const number = (n: number) => n.toLocaleString(formatLocale(), { maximumFractionDigits: 1 });
  if (bytes >= 1024 * 1024) return t('students.files.sizeMb', { size: number(bytes / (1024 * 1024)) });
  return t('students.files.sizeKb', { size: number(Math.max(1, Math.round(bytes / 1024))) });
}
