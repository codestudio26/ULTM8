import React, { useState } from 'react';
import { Button, ErrorBanner, Modal, Spinner } from '@ultm8/ui';
import { ApiError, unwrap, type components } from '@ultm8/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api';
import { useT, type TranslateFn } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

export type SignedDocumentExport = components['schemas']['SignedDocumentExportDto'];
type Labels = components['schemas']['SignedDocumentLabelsDto'];

const busy = (e: SignedDocumentExport | null | undefined) => e?.status === 'PENDING' || e?.status === 'RUNNING';

/** The School's latest export, checked every 2 seconds while it is being made. */
export function useLatestSignedDocumentExport(schoolId: string) {
  return useQuery({
    queryKey: ['signedDocumentExport', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/signed-documents/exports/latest', { params: { path: { schoolId } } })),
    refetchInterval: (query) => (busy(query.state.data?.export) ? 2000 : false),
    retry: false,
  });
}

/** The words inside the ZIP (index headings, document labels), in the reader's language. */
export function signedDocumentLabels(t: TranslateFn): Labels {
  const l = (k: keyof Labels) => t(`waivers.exportAll.labels.${k}` as Parameters<TranslateFn>[0]);
  return {
    member: l('member'),
    document: l('document'),
    version: l('version'),
    signedAt: l('signedAt'),
    signedBy: l('signedBy'),
    file: l('file'),
    guardian: l('guardian'),
    onPaper: l('onPaper'),
    guest: l('guest'),
    signedName: l('signedName'),
    signature: l('signature'),
    recordedBy: l('recordedBy'),
    textSigned: l('textSigned'),
    notRecorded: l('notRecorded'),
    imageMissing: l('imageMissing'),
    expired: l('expired'),
  };
}

function formatSize(bytes: number, t: TranslateFn): string {
  const number = (n: number) => n.toLocaleString(formatLocale(), { maximumFractionDigits: 1 });
  if (bytes >= 1024 * 1024) return t('students.files.sizeMb', { size: number(bytes / (1024 * 1024)) });
  return t('students.files.sizeKb', { size: number(Math.max(1, Math.round(bytes / 1024))) });
}

/**
 * Export all signed documents (Decision 315 item 13): a ZIP of every signed
 * waiver at the School, one document per signature and an index. Made in the
 * background; the owner can close this and come back. The ZIP is kept for 24
 * hours. School owners only (this page is the owner's).
 */
export function SignedDocumentsExportModal({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const latest = useLatestSignedDocumentExport(schoolId);
  const [error, setError] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/schools/{schoolId}/signed-documents/exports', { params: { path: { schoolId } }, body: { labels: signedDocumentLabels(t) } })),
    onSuccess: (created) => queryClient.setQueryData(['signedDocumentExport', schoolId], { export: created }),
  });
  const download = useMutation({
    mutationFn: (exportId: string) =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/signed-documents/exports/{exportId}/download', { params: { path: { schoolId, exportId } } })),
  });

  const current = latest.data?.export ?? null;

  async function onStart() {
    setError(null);
    try {
      await start.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('waivers.exportAll.startFailed'));
    }
  }

  async function onDownload(exportId: string) {
    setError(null);
    try {
      const { url } = await download.mutateAsync(exportId);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('waivers.exportAll.downloadFailed'));
    }
  }

  const until = (iso: string) => new Date(iso).toLocaleString(formatLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <Modal title={t('waivers.exportAll.title')} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ marginTop: 0 }}>{t('waivers.exportAll.intro')}</p>
      {latest.isLoading ? (
        <Spinner />
      ) : latest.error ? (
        <ErrorBanner message={latest.error instanceof ApiError ? latest.error.message : t('waivers.exportAll.loadFailed')} />
      ) : busy(current) ? (
        <p role="status" data-testid="export-status">
          {t('waivers.exportAll.preparing')}
        </p>
      ) : current?.status === 'READY' ? (
        <div data-testid="export-status">
          <p style={{ marginBottom: 4 }}>
            {t('waivers.exportAll.ready', { count: current.documentCount ?? 0, size: formatSize(current.sizeBytes ?? 0, t) })}
          </p>
          {current.expiresAt ? <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>{t('waivers.exportAll.availableUntil', { time: until(current.expiresAt) })}</p> : null}
        </div>
      ) : current?.status === 'FAILED' ? (
        <p data-testid="export-status">{t('waivers.exportAll.failed')}</p>
      ) : current?.status === 'EXPIRED' ? (
        <p data-testid="export-status">{t('waivers.exportAll.expired')}</p>
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        {current?.status === 'READY' ? (
          <>
            <Button onClick={() => void onDownload(current.id)} loading={download.isPending}>
              {t('waivers.exportAll.download')}
            </Button>
            <Button variant="secondary" onClick={() => void onStart()} loading={start.isPending}>
              {t('waivers.exportAll.makeNew')}
            </Button>
          </>
        ) : (
          <Button onClick={() => void onStart()} loading={start.isPending} disabled={busy(current) || latest.isLoading}>
            {t('waivers.exportAll.start')}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t('waivers.exportAll.close')}
        </Button>
      </div>
    </Modal>
  );
}
