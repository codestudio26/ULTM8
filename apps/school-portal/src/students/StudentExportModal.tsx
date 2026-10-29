import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useT } from '../i18n/I18nProvider';
import { downloadCsv } from '../transactions/transactionsCsv';
import { studentExportCsv, studentExportHtml, studentExportTable, type StudentExportFilter } from './studentExport';

/**
 * Export the student list (backlog 3.9, Decision 399): pick which students,
 * then download a CSV or open a page to print. The owner, or Branch Staff the
 * owner allows; children are included with their Guardian. The API logs every
 * export.
 */
export function StudentExportModal({ schoolId, schoolName, withBranch, onClose }: { schoolId: string; schoolName: string; withBranch: boolean; onClose: () => void }) {
  const t = useT();
  const [filter, setFilter] = useState<StudentExportFilter>('ACTIVE');
  const [busy, setBusy] = useState<'csv' | 'print' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'csv' | 'print') {
    setBusy(kind);
    setError(null);
    // Opened now, while the click still counts, so the browser doesn't block it.
    const page = kind === 'print' ? window.open('', '_blank') : null;
    try {
      const data = await unwrap(apiClient.GET('/v1/schools/{id}/students/export', { params: { path: { id: schoolId }, query: { filter } } }));
      const table = studentExportTable(t, data.items, withBranch);
      if (kind === 'csv') {
        downloadCsv(`students-${filter.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`, studentExportCsv(table));
      } else if (page) {
        page.document.open();
        page.document.write(studentExportHtml(t, schoolName, table));
        page.document.close();
      }
      onClose();
    } catch (err) {
      page?.close();
      setError(err instanceof ApiError ? err.message : t('students.export.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={t('students.export.title')} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <Field label={t('students.export.filterLabel')} htmlFor="student-export-filter" hint={t('students.export.childrenNote')}>
        <SelectField
          id="student-export-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as StudentExportFilter)}
          options={[
            { value: 'ACTIVE', label: t('students.export.filterActive') },
            { value: 'ALL', label: t('students.export.filterAll') },
            { value: 'MEMBERS', label: t('students.export.filterMembers') },
            { value: 'VISITORS', label: t('students.export.filterVisitors') },
          ]}
        />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
          {t('common.cancel')}
        </Button>
        <Button variant="secondary" onClick={() => run('print')} loading={busy === 'print'} disabled={busy !== null}>
          {t('students.export.print')}
        </Button>
        <Button onClick={() => run('csv')} loading={busy === 'csv'} disabled={busy !== null}>
          {t('students.export.download')}
        </Button>
      </div>
    </Modal>
  );
}
