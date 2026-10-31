import { useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../../api';
import { batches } from './csv';

export type ImportKind = components['schemas']['ImportKind'];
export type ImportRowCode = components['schemas']['ImportRowCode'];
export type ImportRowResult = components['schemas']['ImportRowResultDto'];
export type ImportWarning = components['schemas']['ImportWarningDto'];
export type ImportLimits = components['schemas']['ImportLimitsDto'];
export type ImportRow = components['schemas']['ImportRowDto'];

/** Rows per request when importing members: each makes an account and
 * sends an email, so smaller batches keep every request quick. */
export const MEMBER_BATCH = 20;

/** The row limits and each kind's columns. The owner, or Branch Staff with "Import data". */
export function useImportLimits(schoolId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['imports', 'limits', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/imports/limits', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId && enabled,
    staleTime: 10 * 60_000,
  });
}

/** What importing the rows would do; nothing changes. Sent in batches the
 * API accepts, then put back together. */
export async function previewImport(schoolId: string, kind: ImportKind, rows: ImportRow[], perRequest: number): Promise<ImportRowResult[]> {
  const out: ImportRowResult[] = [];
  for (const batch of batches(rows, perRequest)) {
    const res = await unwrap(apiClient.POST('/v1/schools/{schoolId}/imports/preview', { params: { path: { schoolId } }, body: { kind, rows: batch } }));
    out.push(...res.rows);
  }
  return out;
}

/** Starts an import; returns its id. */
export async function startImport(schoolId: string, kind: ImportKind, totalRows: number, fileName: string | null): Promise<string> {
  const res = await unwrap(
    apiClient.POST('/v1/schools/{schoolId}/imports', { params: { path: { schoolId } }, body: { kind, totalRows, fileName: fileName ?? undefined } }),
  );
  return res.id;
}

/** Sends one batch. Sent again after a failure, rows already imported return
 * their first result, so nothing is imported twice. */
export async function importBatch(schoolId: string, importId: string, rows: ImportRow[]): Promise<ImportRowResult[]> {
  const res = await unwrap(
    apiClient.POST('/v1/schools/{schoolId}/imports/{importId}/rows', { params: { path: { schoolId, importId } }, body: { rows } }),
  );
  return res.rows;
}

/** Everything an import may have changed is read again. */
export function useInvalidateAfterImport(schoolId: string | null) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['students'] }),
      queryClient.invalidateQueries({ queryKey: ['studentMemberships', schoolId] }),
      queryClient.invalidateQueries({ queryKey: ['attendance-stats', schoolId] }),
      queryClient.invalidateQueries({ queryKey: ['grading-board'] }),
      queryClient.invalidateQueries({ queryKey: ['childInvites'] }),
    ]);
}
