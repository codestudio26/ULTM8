import { useQuery } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type Growth = components['schemas']['GrowthResponseDto'];

/** Students → Growth (backlog 5.8): the last 12 months in the School's time
 * zone. The owner sees the whole School, Branch Staff with "See attendance
 * statistics" their own Branches' students. */
export function useGrowth(schoolId: string | null, branchId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['growth', schoolId, branchId ?? null],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/growth', { params: { path: { schoolId: schoolId! }, query: { branchId } } })),
    enabled: !!schoolId && enabled,
  });
}
