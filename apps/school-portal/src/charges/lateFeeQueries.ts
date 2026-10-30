import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

/** Late fees (Decision 413). */
export type LateFeeSettings = components['schemas']['LateFeeSettingsDto'];
export type UpdateLateFeeInput = components['schemas']['UpdateLateFeeSettingsDto'];

/** GET /schools/:id/late-fees — the owner's setting. */
export function useLateFeeSettings(schoolId: string) {
  return useQuery({
    queryKey: ['late-fees', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/late-fees', { params: { path: { schoolId } } })),
  });
}

export function useUpdateLateFeeSettings(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateLateFeeInput) => unwrap(apiClient.PUT('/v1/schools/{schoolId}/late-fees', { params: { path: { schoolId } }, body })),
    onSuccess: (data) => queryClient.setQueryData(['late-fees', schoolId], data),
  });
}

/** Waive a late fee on the student's Payments card: it is cancelled, with no reason asked for. */
export function useWaiveLateFee(schoolId: string | null, studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chargeId: string) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/charges/{chargeId}/waive-late-fee', { params: { path: { schoolId: schoolId!, chargeId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      return queryClient.invalidateQueries({ queryKey: ['charges', schoolId, studentId] });
    },
  });
}

/** "2.5" or "2,5" → 250 hundredths of a percent; more than 0, up to 100, at most two decimals. Null otherwise. */
export function parseLateFeePercent(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps >= 1 && bps <= 10000 ? bps : null;
}

/** 0 to 30 whole days. Null otherwise. */
export function parseGraceDays(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n <= 30 ? n : null;
}
