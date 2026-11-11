import React, { useState } from 'react';
import { Button, ErrorBanner } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useT } from '../i18n/I18nProvider';
import { StudentCard } from './StudentPageLook';

/**
 * Decision 433 item 10: "Download this member's data", for the School's
 * owner only (the API refuses everyone else). Saves what this School holds
 * about the member as one JSON file; the API logs every download.
 */
export function MemberDataExportCard({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const data = await unwrap(
        apiClient.GET('/v1/schools/{id}/students/{studentId}/data-export', { params: { path: { id: schoolId, studentId } } }),
      );
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `member-data-${studentId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('students.export.memberDataFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StudentCard title={t('students.export.memberDataTitle')} label={t('students.export.memberDataTitle')}>
      <p className="u8sp-card__sub">{t('students.export.memberDataIntro')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      <Button variant="secondary" loading={busy} onClick={download}>
        {t('students.export.memberDataDownload')}
      </Button>
    </StudentCard>
  );
}
