import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

/** The payroll report and its rates (Decision 320 item 4). Owner only. */
export type PayRates = components['schemas']['PayRatesResponseDto'];
export type PayRateRow = components['schemas']['PayRateRowDto'];
export type PayrollReport = components['schemas']['PayrollReportResponseDto'];
export type PayrollRow = components['schemas']['PayrollRowDto'];
export type PayrollPreset = PayrollReport['preset'];

export const PAYROLL_PRESETS: PayrollPreset[] = ['LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'LAST_12_MONTHS', 'CUSTOM'];

export function usePayRates(schoolId: string | null) {
  return useQuery({
    queryKey: ['payroll', 'rates', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/payroll/rates', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    retry: false,
  });
}

/** `from`/`to` are sent only for CUSTOM, and only once both are filled in. */
export function usePayrollReport(schoolId: string | null, preset: PayrollPreset, from: string, to: string) {
  const custom = preset === 'CUSTOM';
  return useQuery({
    queryKey: ['payroll', 'report', schoolId, preset, custom ? from : '', custom ? to : ''],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/payroll/report', {
          params: { path: { schoolId: schoolId! }, query: custom ? { preset, from, to } : { preset } },
        }),
      ),
    enabled: !!schoolId && (!custom || (!!from && !!to)),
    retry: false,
  });
}

export function useSetPayRate(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, hourlyRate, perClassRate }: { userId: string; hourlyRate: number | null; perClassRate: number | null }) =>
      unwrap(
        apiClient.PUT('/v1/schools/{schoolId}/payroll/rates/{userId}', {
          params: { path: { schoolId: schoolId!, userId } },
          body: { hourlyRate, perClassRate },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['payroll', 'rates', schoolId], data);
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'report', schoolId] });
    },
  });
}
