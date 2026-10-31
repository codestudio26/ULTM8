import React, { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Checkbox, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../../auth/AuthContext';
import { useI18n, useT, type TranslationKey } from '../../i18n/I18nProvider';
import { useMyStaffAccess } from '../../roleGrants/roleGrantQueries';
import { csvCell, downloadCsv } from '../../transactions/transactionsCsv';
import { StudentsTabs } from '../StudentsTabs';
import { batches, markRepeats, readImportFile, templateCsv, type ParsedImport } from './csv';
import {
  MEMBER_BATCH,
  importBatch,
  previewImport,
  startImport,
  useImportLimits,
  useInvalidateAfterImport,
  type ImportKind,
  type ImportRowResult,
} from './importQueries';

const KINDS: ImportKind[] = ['MEMBERS', 'MEMBERSHIPS', 'ATTENDANCE'];

/** One example row per kind, for the template. */
const EXAMPLES: Record<ImportKind, Record<string, string>> = {
  MEMBERS: {
    first_name: 'Ana',
    last_name: 'Silva',
    email: 'ana.silva@example.com',
    phone: '+44 7911 123456',
    date_of_birth: '1990-05-06',
    gender: 'Female',
    join_date: '2024-02-01',
    belts: 'Brazilian Jiu-Jitsu: Blue',
  },
  MEMBERSHIPS: { email: 'ana.silva@example.com', plan: '10 Class Pack', start_date: '2026-09-01', end_date: '2026-12-31', classes_left: '6' },
  ATTENDANCE: { email: 'ana.silva@example.com', date: '2026-10-20', time: '18:30', class: 'Fundamentals' },
};

/** Who may import: the owner, or Branch Staff with "Import data" (Decision 315 items 12, 13). */
export function useMayImport(schoolId: string | null): boolean {
  const access = useMyStaffAccess(schoolId).data;
  return !!access && (access.owner || (access.branchStaff && access.access.importData));
}

/** The API's own reasons (a refused row, a belt not set), translated once
 * they arrive, so the table and the downloaded results read the same. */
function useServerTexts(messages: string[]): Map<string, string> {
  const { serverText } = useI18n();
  const [texts, setTexts] = useState(new Map<string, string>());
  const key = [...new Set(messages)].sort().join('\u0000');
  useEffect(() => {
    let cancelled = false;
    const unique = key ? key.split('\u0000') : [];
    void Promise.all(unique.map(async (m) => [m, await serverText.error(400, '', m)] as const)).then((pairs) => {
      if (!cancelled) setTexts(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [key, serverText]);
  return texts;
}

type Phase = 'idle' | 'checking' | 'checked' | 'importing' | 'stopped' | 'done';

/**
 * Students → Import (Decision 315 items 12 and 13; backlog 5.13): members,
 * memberships and past attendance from a spreadsheet saved as CSV. The file
 * is read here; the API checks every row in a preview that changes nothing,
 * then imports it in batches. A batch sent again returns its first results,
 * so an import that stopped carries on with "Try again" and nothing is
 * imported twice.
 */
export function ImportPage() {
  const t = useT();
  const schoolId = useGradingSchoolId();
  const access = useMyStaffAccess(schoolId);
  const may = useMayImport(schoolId);
  const limits = useImportLimits(schoolId, may);
  const invalidate = useInvalidateAfterImport(schoolId);

  const [kind, setKind] = useState<ImportKind>('MEMBERS');
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportRowResult[]>([]);
  const [importId, setImportId] = useState<string | null>(null);
  // Each row's import result so far, kept across "Try again".
  const imported = useRef(new Map<number, ImportRowResult>());
  const [error, setError] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const reasons = useServerTexts(
    results.flatMap((r) => [...(r.code === 'FAILED' ? [r.message] : []), ...r.warnings.map((w) => w.reason ?? '').filter(Boolean)]),
  );

  if (!schoolId || access.isLoading) return <Spinner />;

  const columns = limits.data?.columns[kind] ?? [];
  const maxRows = limits.data?.maxRows ?? 2000;
  const perRequest = limits.data?.maxRowsPerRequest ?? 100;
  const days = limits.data?.attendanceMaxDaysBack ?? 30;
  const rows = parsed?.rows ?? [];
  const tooMany = rows.length > maxRows;
  const busy = phase === 'checking' || phase === 'importing';

  const reset = () => {
    setPhase('idle');
    setResults([]);
    setImportId(null);
    imported.current = new Map();
    setError(null);
    setProgress(0);
  };

  const chooseKind = (next: ImportKind) => {
    setKind(next);
    setParsed(null);
    setFileName(null);
    setFileError(null);
    reset();
  };

  const readFile = async (file: File | null) => {
    reset();
    setParsed(null);
    setFileError(null);
    setFileName(file?.name ?? null);
    if (!file) return;
    try {
      const read = readImportFile(await file.text(), columns);
      if (read.rows.length === 0) setFileError(t('imports.empty'));
      setParsed(read);
    } catch {
      setFileError(t('imports.readFailed'));
    }
  };

  const check = async () => {
    reset();
    setPhase('checking');
    try {
      const out: ImportRowResult[] = [];
      for (const batch of batches(rows, perRequest)) {
        out.push(...(await previewImport(schoolId, kind, batch, perRequest)));
        setProgress(out.length);
      }
      // The API checks each batch on its own; the same row twice in different
      // batches shows here as it will import: the later one skipped.
      markRepeats(kind, rows, out);
      setResults(out);
      setPhase('checked');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('imports.readFailed'));
      setPhase('idle');
    }
  };

  /** Imports the file, or carries on after a stop: rows already imported
   * return their first results. */
  const runImport = async () => {
    setError(null);
    setPhase('importing');
    const done = imported.current;
    try {
      const id = importId ?? (await startImport(schoolId, kind, rows.length, fileName));
      setImportId(id);
      // Every row is sent, so the API checks it again and keeps its result.
      const todo = rows.filter((r) => !done.has(r.rowNumber));
      setProgress(done.size);
      for (const batch of batches(todo, kind === 'MEMBERS' ? MEMBER_BATCH : perRequest)) {
        for (const r of await importBatch(schoolId, id, batch)) done.set(r.rowNumber, r);
        setProgress(done.size);
        // Imported rows show their result; the rest their preview until reached.
        setResults((prev) => prev.map((r) => done.get(r.rowNumber) ?? r));
      }
      setPhase('done');
      await invalidate();
    } catch (err) {
      setError(err instanceof ApiError ? `${t('imports.importFailed')} ${err.message}` : t('imports.importFailed'));
      setPhase('stopped');
    }
  };

  const detailsOf = (r: ImportRowResult): string[] => {
    const lines = [r.code === 'FAILED' ? (reasons.get(r.message) ?? r.message) : t(`imports.codes.${r.code}` as TranslationKey, { days })];
    if (r.column && r.outcome === 'ERROR') lines.push(t('imports.inColumn', { column: r.column }));
    for (const w of r.warnings) {
      const text = t(`imports.warnings.${w.code}` as TranslationKey, { style: w.style ?? '' });
      lines.push(w.reason ? `${text} ${reasons.get(w.reason) ?? w.reason}` : text);
    }
    return lines;
  };

  const valuesOf = (rowNumber: number) => rows[rowNumber - 2]?.values ?? {};
  const memberOf = (rowNumber: number) => {
    const v = valuesOf(rowNumber);
    const name = [v.first_name, v.last_name].filter(Boolean).join(' ');
    const email = v.email || v.guardian_email || '';
    return [name, email].filter(Boolean).join(' · ');
  };

  const counts = {
    ok: results.filter((r) => r.outcome === 'READY' || r.outcome === 'CREATED').length,
    skipped: results.filter((r) => r.outcome === 'SKIPPED').length,
    errors: results.filter((r) => r.outcome === 'ERROR').length,
  };
  const shown = onlyProblems ? results.filter((r) => r.outcome === 'SKIPPED' || r.outcome === 'ERROR') : results;
  const badge = (r: ImportRowResult) => {
    const variant = r.outcome === 'ERROR' ? 'danger' : r.outcome === 'SKIPPED' ? 'warning' : r.outcome === 'CREATED' ? 'success' : 'info';
    return <Badge variant={variant}>{t(`imports.outcome.${r.outcome}` as TranslationKey)}</Badge>;
  };

  const downloadResults = () => {
    const header = [t('imports.columns.row'), t('imports.columns.result'), t('imports.columns.details'), ...columns];
    const lines = [header, ...results.map((r) => [String(r.rowNumber), t(`imports.outcome.${r.outcome}` as TranslationKey), detailsOf(r).join(' '), ...columns.map((c) => valuesOf(r.rowNumber)[c] ?? '')])];
    downloadCsv(`import-results-${kind.toLowerCase()}.csv`, `﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`);
  };

  return (
    <>
      <PageHeader title={t('students.title')} subtitle={t('imports.subtitle')} />
      <StudentsTabs />
      {!may ? (
        <Card>
          <p style={{ margin: 0 }}>{t('imports.noAccess')}</p>
        </Card>
      ) : (
        <>
          <Card>
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label={t('imports.kindLabel')} htmlFor="import-kind">
                <SelectField
                  id="import-kind"
                  value={kind}
                  disabled={busy}
                  onChange={(e) => chooseKind(e.target.value as ImportKind)}
                  options={KINDS.map((k) => ({ value: k, label: t(`imports.kinds.${k}` as TranslationKey) }))}
                />
              </Field>
              <p style={{ margin: 0 }}>{t(`imports.about.${kind}` as TranslationKey, { days })}</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)' }}>{t('imports.formatHint', { max: maxRows })}</p>
              <div>
                <Button variant="secondary" disabled={!columns.length} onClick={() => downloadCsv(`ultm8-import-${kind.toLowerCase()}.csv`, templateCsv(columns, EXAMPLES[kind]))}>
                  {t('imports.template')}
                </Button>
              </div>
              <Field label={t('imports.file')} htmlFor="import-file">
                <input
                  key={kind}
                  id="import-file"
                  data-testid="import-file"
                  type="file"
                  accept=".csv,text/csv"
                  disabled={busy || !columns.length}
                  onChange={(e) => void readFile(e.target.files?.[0] ?? null)}
                />
              </Field>
              {fileError ? <ErrorBanner message={fileError} /> : null}
              {tooMany ? <ErrorBanner message={t('imports.tooMany', { count: rows.length, max: maxRows })} /> : null}
              {parsed?.missingColumns.length ? (
                <p style={{ margin: 0, fontSize: 13 }}>{t('imports.missingColumns', { columns: parsed.missingColumns.join(', ') })}</p>
              ) : null}
              {parsed?.unknownColumns.length ? (
                <p style={{ margin: 0, fontSize: 13 }}>{t('imports.unknownColumns', { columns: parsed.unknownColumns.join(', ') })}</p>
              ) : null}
              {rows.length > 0 && !tooMany && (phase === 'idle' || phase === 'checking') ? (
                <div>
                  <Button onClick={() => void check()} loading={phase === 'checking'} disabled={busy}>
                    {t('imports.previewButton')}
                  </Button>
                </div>
              ) : null}
              {phase === 'checking' ? <p style={{ margin: 0 }}>{t('imports.checking', { done: progress, total: rows.length })}</p> : null}
            </div>
          </Card>

          {error ? <ErrorBanner message={error} /> : null}

          {results.length ? (
            <Card>
              <div style={{ display: 'grid', gap: 12 }}>
                {phase === 'checked' ? <p style={{ margin: 0 }}>{t('imports.previewIntro')}</p> : null}
                {phase === 'done' ? <SuccessBanner message={t('imports.done', counts)} /> : <p style={{ margin: 0, fontWeight: 600 }}>{t('imports.previewCounts', counts)}</p>}
                {phase === 'importing' ? <p style={{ margin: 0 }}>{t('imports.importing', { done: progress, total: rows.length })}</p> : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {phase === 'checked' ? (
                    <Button onClick={() => void runImport()} disabled={counts.ok === 0}>
                      {t('imports.importButton')}
                    </Button>
                  ) : null}
                  {phase === 'stopped' ? <Button onClick={() => void runImport()}>{t('imports.retry')}</Button> : null}
                  {phase === 'done' ? (
                    <>
                      <Button variant="secondary" onClick={downloadResults}>
                        {t('imports.downloadResults')}
                      </Button>
                      <Button variant="secondary" onClick={() => chooseKind(kind)}>
                        {t('imports.startOver')}
                      </Button>
                    </>
                  ) : null}
                  <Checkbox label={t('imports.onlyProblems')} checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                </div>
                <Table
                  columns={[
                    { key: 'row', header: t('imports.columns.row'), render: (r) => r.rowNumber },
                    { key: 'member', header: t('imports.columns.member'), render: (r) => memberOf(r.rowNumber) },
                    { key: 'result', header: t('imports.columns.result'), render: (r) => badge(r) },
                    {
                      key: 'details',
                      header: t('imports.columns.details'),
                      render: (r) => (
                        <div>
                          {detailsOf(r).map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                        </div>
                      ),
                    },
                  ]}
                  rows={shown.map((r) => ({ ...r, id: String(r.rowNumber) }))}
                />
              </div>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}

